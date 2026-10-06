import { Koios, Lucid, type LucidEvolution, type Network, type Provider, type UTxO } from "@lucid-evolution/lucid";

export const KOIOS_URL = "https://preprod.koios.rest/api/v1";
const key = () => process.env.KAIOS_KEY ?? process.env.KOIOS_API_KEY ?? (() => { throw new Error("KAIOS_KEY is not set"); })();
let installed = false;
export function installKoios(): void {
  if (installed) return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(KOIOS_URL)) return original(input, init);
    if (url.endsWith("/tx_info")) {
      const source = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
      if (source) {
        const body = JSON.parse(source) as Record<string, unknown>;
        body._bytecode = true;
        if (input instanceof Request && init?.body === undefined) input = new Request(input, { body: JSON.stringify(body) });
        else init = { ...init, body: JSON.stringify(body) };
      }
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("authorization", `Bearer ${key()}`);
    for (let attempt = 0; ; attempt++) {
      const response = await original(input, { ...init, headers });
      if (response.status !== 429 || attempt >= 5) return response;
      const wait = Number(response.headers.get("retry-after") ?? 0) * 1000 || 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }) as typeof fetch;
  installed = true;
}
export async function makeLucid(): Promise<LucidEvolution> {
  installKoios();
  const koios = new Koios(KOIOS_URL);
  const provider = Object.assign(Object.create(koios) as Provider, {
    getUtxosByOutRef: async (refs: Array<{ txHash: string; outputIndex: number }>): Promise<UTxO[]> => {
      const response = await fetch(`${KOIOS_URL}/tx_info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ _tx_hashes: [...new Set(refs.map((ref) => ref.txHash))], _assets: true, _scripts: true, _bytecode: true }) });
      if (!response.ok) throw new Error(`Koios tx_info returned ${response.status}`);
      const rows = await response.json() as Array<{ block_height: number; outputs: Array<any> }>;
      return rows.flatMap((row) => row.outputs.map((output) => ({
        txHash: output.tx_hash,
        outputIndex: output.tx_index,
        address: output.payment_addr.bech32,
        assets: { lovelace: BigInt(output.value), ...Object.fromEntries((output.asset_list ?? []).map((asset: any) => [`${asset.policy_id}${asset.asset_name ?? ""}`, BigInt(asset.quantity)])) },
        datum: output.inline_datum?.bytes ?? undefined,
        datumHash: output.datum_hash ?? undefined,
        scriptRef: undefined,
      }))).filter((utxo) => refs.some((ref) => ref.txHash === utxo.txHash && ref.outputIndex === utxo.outputIndex)) as UTxO[];
    },
  });
  return Lucid(provider, "Preprod" as Network);
}
export async function waitForTx(txHash: string, timeoutMs = 240_000): Promise<{ txHash: string; confirmations: number }> {
  installKoios();
  const deadline = Date.now() + timeoutMs;
  let last = "not indexed";
  while (Date.now() < deadline) {
    const response = await fetch(`${KOIOS_URL}/tx_status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ _tx_hashes: [txHash] }) });
    if (response.ok) {
      const rows = await response.json() as Array<{ tx_hash?: string; num_confirmations?: number | null; status?: string; error?: string }>;
      const row = rows[0];
      if (row?.status && /fail|reject|invalid/i.test(row.status)) throw new Error(`tx ${txHash} failed: ${row.status} ${row.error ?? ""}`.trim());
      if ((row?.num_confirmations ?? 0) >= 1) return { txHash, confirmations: row.num_confirmations ?? 0 };
      last = row ? `confirmations=${row.num_confirmations ?? 0}` : "not indexed";
    } else last = `Koios HTTP ${response.status}`;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  throw new Error(`tx ${txHash} was not confirmed within ${timeoutMs} ms (${last})`);
}
