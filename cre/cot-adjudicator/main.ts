import { HTTPCapability, HTTPClient, Runner, consensusIdenticalAggregation, decodeJson, handlerInTee, hexToBase64, type HTTPPayload, type HTTPSendRequester, type Report, type TeeRuntime } from "@chainlink/cre-sdk";
import { buildBody, DECISION_BYTE, decide, type Decision } from "./src/decide";
import { readFacts, type Ref, type Post } from "./src/koios";

export type Config = { koiosUrl: string; koiosKeySecret: string; relayerUrl: string; verbose?: boolean };
type Trigger = { coverageRef: string };
type ReportResponse = { rawReport: Uint8Array; reportContext: Uint8Array; sigs: Array<{ signature: Uint8Array }> };
type RequestJson = { url: string; method: "POST"; body: string; headers: Record<string, string>; cacheSettings: { store: boolean; maxAge: string } };
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const parseRef = (value: string): Ref => { const [txHash, index] = value.split("#"); if (!/^[0-9a-f]{64}$/i.test(txHash) || !/^\d+$/.test(index ?? "")) throw new Error("out-ref must be txhash#index"); return { txHash, index: Number(index) }; };
const reportRequest = (url: string) => (r: ReportResponse): RequestJson => ({ url, method: "POST", headers: { "content-type": "application/json" }, cacheSettings: { store: true, maxAge: "60s" }, body: Buffer.from(JSON.stringify({ raw_report: hex(r.rawReport), report_context: hex(r.reportContext), sigs: r.sigs.map((s) => hex(s.signature)) })).toString("base64") });
const send = (sr: HTTPSendRequester, report: Report, url: string) => sr.sendReport(report, reportRequest(url)).result();
const postFor = (runtime: TeeRuntime<Config>, bearer: string): Post => (path, body) => new HTTPClient().sendRequest(runtime, { url: `${runtime.config.koiosUrl.replace(/\/$/, "")}/${path}`, method: "POST", multiHeaders: { authorization: { values: [`Bearer ${bearer}`] }, "content-type": { values: ["application/json"] } }, body: Buffer.from(JSON.stringify(body)).toString("base64") }).result();

export const onTrigger = (runtime: TeeRuntime<Config>, payload: HTTPPayload): string => {
  const trigger = decodeJson(payload.input) as Trigger;
  if (!trigger || typeof trigger.coverageRef !== "string") throw new Error("trigger needs coverageRef");
  const bearer = runtime.getSecret({ id: runtime.config.koiosKeySecret }).result().value;
  const coverage = parseRef(trigger.coverageRef); const outcome = readFacts(postFor(runtime, bearer), coverage, runtime.now().getTime());
  const decision = decide(outcome.facts).decision; const don = runtime.usingTheDons();
  const agreedByte = don.runInNodeMode((_node, value: number) => value, consensusIdenticalAggregation<number>())(DECISION_BYTE[decision]).result();
  const agreed = (Object.entries(DECISION_BYTE).find(([, value]) => value === agreedByte)?.[0] ?? "INCONCLUSIVE") as Decision;
  // Settle is only open from task_expiry to decide_by and never takes INCONCLUSIVE: no report is cut outside that, the underwriter recovers through Expire.
  if (agreed === "INCONCLUSIVE" || outcome.facts.now > outcome.facts.decideBy) return JSON.stringify({ report: false, decision: agreed, delivered: false });
  const body = buildBody(outcome.termsHash, agreed, outcome.coverageTxHash, outcome.coverageIndex, outcome.taskRef.txHash, outcome.taskRef.index);
  const report = runtime.reportFromDon({ encodedPayload: hexToBase64(hex(body)), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" }).result();
  const sent = new HTTPClient().sendRequest(don, (sr: HTTPSendRequester) => { const response = send(sr, report, `${runtime.config.relayerUrl.replace(/\/$/, "")}/report`); return { status: response.statusCode, body: new TextDecoder().decode(response.body) }; }, consensusIdenticalAggregation<{ status: number; body: string }>())().result();
  if (runtime.config.verbose) runtime.log(`decision ${agreed}: ${sent.status}`);
  return JSON.stringify({ report: true, decision: agreed, delivered: sent.status >= 200 && sent.status < 300 });
};

export const initWorkflow = (config: Config) => [handlerInTee(new HTTPCapability().trigger({}), onTrigger, {})];
export async function main() { const runner = await Runner.newRunner<Config>(); await runner.run(initWorkflow); }
