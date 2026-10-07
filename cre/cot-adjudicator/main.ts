import { HTTPCapability, HTTPClient, Runner, consensusIdenticalAggregation, decodeJson, handlerInTee, hexToBase64, type HTTPPayload, type HTTPSendRequester, type NodeRuntime, type Report, type TeeRuntime } from "@chainlink/cre-sdk";
import { buildBody, DECISION_BYTE, type Decision } from "./src/decide";
import { adjudicate, type Trigger } from "./src/adjudicate";
import type { Post } from "./src/koios";

export type Config = { koiosUrl: string; koiosKeySecret: string; relayerUrl: string; claimVaultHash: string; verbose?: boolean };
type ReportResponse = { rawReport: Uint8Array; reportContext: Uint8Array; sigs: Array<{ signature: Uint8Array }> };
type RequestJson = { url: string; method: "POST"; body: string; headers: Record<string, string>; cacheSettings: { store: boolean; maxAge: string } };
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const reportRequest = (url: string, nonce: string) => (r: ReportResponse): RequestJson => ({ url: `${url}?nonce=${encodeURIComponent(nonce)}`, method: "POST", headers: { "content-type": "application/json" }, cacheSettings: { store: true, maxAge: "60s" }, body: Buffer.from(JSON.stringify({ raw_report: hex(r.rawReport), report_context: hex(r.reportContext), sigs: r.sigs.map((s) => hex(s.signature)) })).toString("base64") });
const send = (sr: HTTPSendRequester, report: Report, url: string, nonce: string) => sr.sendReport(report, reportRequest(url, nonce)).result();
const postFor = (runtime: NodeRuntime<Config>, bearer: string): Post => (path, body) => new HTTPClient().sendRequest(runtime, { url: `${runtime.config.koiosUrl.replace(/\/$/, "")}/${path}`, method: "POST", multiHeaders: { authorization: { values: [`Bearer ${bearer}`] }, "content-type": { values: ["application/json"] } }, body: Buffer.from(JSON.stringify(body)).toString("base64") }).result();

export const onTrigger = (runtime: TeeRuntime<Config>, payload: HTTPPayload): string => {
  const trigger = decodeJson(payload.input) as Trigger;
  const bearer = runtime.getSecret({ id: runtime.config.koiosKeySecret }).result().value;
  const don = runtime.usingTheDons();
  const outcome = don.runInNodeMode((node) => adjudicate(postFor(node, bearer), trigger, node.now().getTime(), node.config.claimVaultHash), consensusIdenticalAggregation<ReturnType<typeof adjudicate>>())().result();
  const decision = outcome.decision;
  // Settle is only open from task_expiry to decide_by and never takes INCONCLUSIVE: no report is cut outside that, the underwriter recovers through Expire.
  if (decision === "INCONCLUSIVE" || outcome.facts.now > outcome.facts.decideBy) return JSON.stringify({ report: false, decision, delivered: false });
  const body = buildBody(outcome.termsHash, decision, outcome.coverageTxHash, outcome.coverageIndex, outcome.taskRef.txHash, outcome.taskRef.index);
  const report = runtime.reportFromDon({ encodedPayload: hexToBase64(hex(body)), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" }).result();
  const sent = new HTTPClient().sendRequest(don, (sr: HTTPSendRequester) => { const response = send(sr, report, `${runtime.config.relayerUrl.replace(/\/$/, "")}/report`, trigger.nonce); return { status: response.statusCode, body: new TextDecoder().decode(response.body) }; }, consensusIdenticalAggregation<{ status: number; body: string }>())().result();
  if (runtime.config.verbose) runtime.log(`decision ${decision}: ${sent.status}`);
  return JSON.stringify({ report: true, decision, delivered: sent.status >= 200 && sent.status < 300 });
};

export const initWorkflow = (config: Config) => [handlerInTee(new HTTPCapability().trigger({}), onTrigger, {})];
export async function main() { const runner = await Runner.newRunner<Config>(); await runner.run(initWorkflow); }
