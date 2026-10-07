import { settle, type Report } from "@cost-of-trust/offchain";
import { context, config, json, parseRef } from "./common";
import { incompatibility } from "./attest";
const { lucid, deployment: d } = await context("relayer");
let lastReport: Report | undefined;
let expectedNonce: string | undefined;
const root = new URL("..", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function simulateCre(payload: { coverageRef: string; nonce: string }): Promise<Report> {
  lastReport = undefined;
  const configPath = `/tmp/cot-cre-${process.pid}.json`;
  await Bun.write(configPath, JSON.stringify({ koiosUrl: "https://preprod.koios.rest/api/v1", koiosKeySecret: "KAIOS_KEY", relayerUrl: `http://127.0.0.1:${Number(process.env.PORT ?? 4111)}`, claimVaultHash: "584e049ca0f1fc528c3ca3551145a6f074e9cdc5635ece1df4b5563b", verbose: true }));
  const child = Bun.spawn(["cre", "workflow", "simulate", "cot-adjudicator", "--target", "staging-settings", "--trigger-index", "0", "--config", configPath, "--http-payload", JSON.stringify(payload), "--non-interactive"], { cwd: `${root}cre`, env: { ...process.env, CRE_KAIOS_KEY: process.env.KAIOS_KEY }, stdout: "pipe", stderr: "pipe" });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const deadline = Date.now() + 240_000;
  while (!lastReport && Date.now() < deadline) {
    if (child.exitCode !== null) break;
    await sleep(1_000);
  }
  const [stdout, stderr] = await output;
  await child.exited;
  await Bun.write(new URL(`../cre/evidence/simulate-${Date.now()}.log`, import.meta.url), `${stdout}\n${stderr}`);
  if (!lastReport) throw new Error(`CRE simulation did not deliver a report (exit ${child.exitCode})`);
  return lastReport;
}
function flipped(report: Report): Report {
  const raw = Buffer.from(report.raw_report, "hex");
  if (raw.length !== 210) throw new Error(`CRE raw report must be 210 bytes, got ${raw.length}`);
  raw[141] ^= 1;
  return { ...report, raw_report: raw.toString("hex") };
}
Bun.serve({ port: Number(process.env.PORT ?? 4111), async fetch(request) { try {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/report") { if (!expectedNonce || url.searchParams.get("nonce") !== expectedNonce) return json({ error: "report nonce rejected" }, 401); const report = await request.json() as Report; const issue = incompatibility(report, config()); if (issue) return json({ error: `workflow report rejected: ${issue}` }, 400); lastReport = report; await Bun.write(new URL("../cre/evidence/relayer-report.json", import.meta.url), JSON.stringify(lastReport, null, 2)); return json({ accepted: true }); }
  if (request.method === "POST" && url.pathname === "/adjudicate") {
    const b = await request.json() as { coverageRef: string; buyerAddress: string; underwriterAddress: string; report?: Report; flipReport?: boolean };
    if (b.report) throw new Error("report input is not accepted; reports must come from the workflow");
    expectedNonce = crypto.randomUUID();
    const report = await simulateCre({ coverageRef: b.coverageRef, nonce: expectedNonce });
    const nativeIncompatibility = incompatibility(report, config());
    if (nativeIncompatibility) throw new Error(`workflow report rejected: ${nativeIncompatibility}`);
    const attestation = { source: "cre", decisionByte: Buffer.from(report.raw_report, "hex")[141] };
    let rejectedSettle: string | undefined;
    if (b.flipReport) { try { await settle(lucid, d, parseRef(b.coverageRef), flipped(report), config(), b.buyerAddress, b.underwriterAddress); } catch (error) { rejectedSettle = error instanceof Error ? error.message : String(error); } if (!rejectedSettle) throw new Error("flipped CRE report unexpectedly settled"); }
    const txHash = await settle(lucid, d, parseRef(b.coverageRef), report, config(), b.buyerAddress, b.underwriterAddress);
    return json({ txHash, rejectedSettle, attestation });
  }
  return json({ error: "not found" }, 404);
} catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); } } });
console.log(JSON.stringify({ port: Number(process.env.PORT ?? 4111) }));
