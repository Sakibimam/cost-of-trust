import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const count = Number(Bun.env.N ?? 60);
const spacingMs = Number(Bun.env.SPACING_MS ?? 1000);
const timeoutMs = Number(Bun.env.TIMEOUT_MS ?? 8000);
if (!Number.isInteger(count) || count < 1 || count > 600) throw new Error("N must be an integer from 1 to 600");
if (!Number.isInteger(spacingMs) || spacingMs < 0 || spacingMs > 60000) throw new Error("SPACING_MS must be 0..60000");

function valueFromZshrc(name: string): string | undefined {
  const text = existsSync(`${Bun.env.HOME}/.zshrc`) ? requireText(`${Bun.env.HOME}/.zshrc`) : "";
  const match = text.match(new RegExp(`^(?:export\\s+)?${name}=([\\"']?)([^\\"'\\n]+)\\1\\s*$`, "m"));
  return match?.[2];
}

function requireText(path: string): string {
  return readFileSync(path, "utf8");
}

const kaios = Bun.env.KAIOS_KEY;
const tatum = Bun.env.TATUM_API_KEY ?? valueFromZshrc("TATUM_API_KEY");
const nownodes = Bun.env.NOWNODES_KEY ?? valueFromZshrc("NOWNODES_KEY");

type Probe = { id: string; url: string; method: "GET" | "POST"; body?: string; headers?: Record<string, string>; enabled: boolean; exclusionReason?: string };
const probes: Probe[] = [
  { id: "koios-preprod-authenticated", url: "https://preprod.koios.rest/api/v1/tip", method: "GET", headers: kaios ? { Authorization: `Bearer ${kaios}` } : undefined, enabled: Boolean(kaios), exclusionReason: "KAIOS_KEY is not set" },
  { id: "koios-preprod-public", url: "https://preprod.koios.rest/api/v1/tip", method: "GET", enabled: true },
  { id: "tatum-cardano-preprod", url: "https://cardano-preprod.gateway.tatum.io/network/status", method: "POST", body: JSON.stringify({ network_identifier: { blockchain: "cardano", network: "preprod" } }), headers: tatum ? { "x-api-key": tatum, "content-type": "application/json" } : undefined, enabled: Boolean(tatum), exclusionReason: "TATUM_API_KEY is not set" },
];

const nownodesUrls = ["https://cardano-preprod.nownodes.io/api/v0/tip", "https://cardano.nownodes.io/api/v0/tip"];
const records: Record<string, unknown>[] = [];
const startedAt = new Date().toISOString();

async function call(probe: Probe, attempt: number) {
  if (!probe.enabled) {
    records.push({ provider: probe.id, attempt, ok: false, status: null, latencyMs: null, error: probe.exclusionReason });
    return;
  }
  const started = performance.now();
  let status: number | null = null;
  try {
    const response = await fetch(probe.url, { method: probe.method, headers: probe.headers, body: probe.body, signal: AbortSignal.timeout(timeoutMs) });
    status = response.status;
    await response.arrayBuffer();
    records.push({ provider: probe.id, attempt, ok: response.ok, status, latencyMs: Math.round(performance.now() - started) });
  } catch (error) {
    records.push({ provider: probe.id, attempt, ok: false, status, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : "request failed" });
  }
}

for (const probe of probes) {
  for (let attempt = 1; attempt <= count; attempt++) {
    await call(probe, attempt);
    if (attempt < count && spacingMs) await Bun.sleep(spacingMs);
  }
}

for (const url of nownodesUrls) {
  const started = performance.now();
  try {
    const response = nownodes ? await fetch(url, { headers: { api_key: nownodes }, signal: AbortSignal.timeout(timeoutMs) }) : undefined;
    records.push({ provider: "nownodes-cardano", endpoint: url, attempt: 1, ok: false, status: response?.status ?? null, latencyMs: Math.round(performance.now() - started), error: response ? "Cardano endpoint is not available on the tested NOWNodes hostname; excluded as mainnet-only" : "NOWNODES_KEY is not set" });
    if (response) await response.arrayBuffer();
  } catch (error) {
    records.push({ provider: "nownodes-cardano", endpoint: url, attempt: 1, ok: false, status: null, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : "request failed" });
  }
}

const output = join(import.meta.dir, `results-${startedAt.replaceAll(/[-:.TZ]/g, "").slice(0, 14)}.json`);
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, JSON.stringify({ startedAt, count, spacingMs, timeoutMs, providers: probes.map(({ headers: _headers, ...probe }) => probe), records }, null, 2) + "\n");
console.log(output);
