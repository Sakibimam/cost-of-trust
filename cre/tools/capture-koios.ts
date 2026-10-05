const base = "https://preprod.koios.rest/api/v1";
const key = process.env.KAIOS_KEY;
if (!key) throw new Error("KAIOS_KEY is required in the environment");
const post = async (path: string, body: unknown) => {
  const response = await fetch(`${base}/${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return await response.json();
};
const unspentAddress = "addr_test1wr6mg7a8fl6hxvfm29qa059kqts66rp99kqhprp4eyz6qssneq8jn";
const spentLock = "c9a8339b6e51bc86a1437fecd6f130647ed20a20ef238001a9c9dfd5711b47bc";
const spentSettlement = "c85a1fdc4d271df2d668fd97c28903e18cef9a8cff9c496bf16b2487d4df69df";
const raw = {
  capturedAt: new Date().toISOString(),
  source: `${base} (preprod)`,
  spentBeforeExpiry: {
    lockTxInfo: await post("tx_info", { _tx_hashes: [spentLock], _inputs: true, _metadata: true, _assets: false, _withdrawals: false, _certs: true, _scripts: true, _bytecode: true }),
    spendingTxInfo: await post("tx_info", { _tx_hashes: [spentSettlement], _inputs: true, _metadata: true, _assets: false, _withdrawals: false, _certs: true, _scripts: true, _bytecode: true }),
  },
  unspent: {
    address: unspentAddress,
    addressUtxos: await post("address_utxos", { _addresses: [unspentAddress], _extended: true }),
  },
  tip: await post("tip", {}),
};
await Bun.write(new URL("../fixtures/koios-live.json", import.meta.url), JSON.stringify(raw, null, 2));
console.log("captured real Koios preprod responses: spent-before-expiry and unspent UTxO");
