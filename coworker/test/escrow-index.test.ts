import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryHistory, mergeIndexed, setEscrowIndexForTests, tallyDelivery, toIndexed, type DeliveryTally, type EscrowIndex } from "../src/koios.ts";

const POLICY = "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9";
const UNIT = POLICY + "c".repeat(64);
const SELLER = "f0".repeat(28);
const BUYER = "e5".repeat(28);
const CONTRACT = "addr1wx7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsq87ujx7";

const cred = (bytes: string) => ({ constructor: 0, fields: [{ constructor: 0, fields: [{ bytes }] }] });
// V2 escrow datum: 19 fields, seller at 2, agent identifier at 8, state is the last constructor.
const datum = (state: number) => ({ constructor: 0, fields: [cred(BUYER), {}, cred(SELLER), {}, {}, {}, {}, {}, { bytes: UNIT }, {}, {}, {}, {}, {}, {}, {}, {}, {}, { constructor: state }] });

const open = (hash: string, block: number, at: number) => ({ tx_hash: hash, block_height: block, tx_timestamp: at, inputs: [], plutus_contracts: [], outputs: [{ payment_addr: { bech32: CONTRACT }, inline_datum: { value: datum(0) } }] });
const spend = (hash: string, block: number, at: number, opened: string, redeemer: number) => ({
  tx_hash: hash, block_height: block, tx_timestamp: at, outputs: [],
  inputs: [{ tx_hash: opened, tx_index: 0, payment_addr: { bech32: CONTRACT }, inline_datum: { value: datum(0) } }],
  plutus_contracts: [{ valid_contract: true, spends_input: { tx_hash: opened, tx_index: 0 }, input: { redeemer: { datum: { value: { constructor: redeemer } } } } }],
});

// Redeemers: 0 paid, 3 refunded, 5 result submitted.
// 22 newer opens push open2 out of the 20 events an index entry keeps, so only openPending can carry it.
const filler = Array.from({ length: 22 }, (_, i) => open(`filler${i}`, 12, 2000 + i));
const history = [
  open("open1", 10, 1000), open("open2", 11, 1100), open("open3", 11, 1110), ...filler,
  spend("submit1", 12, 1060, "open1", 5), spend("pay1", 12, 1200, "open1", 0),
  spend("submit2", 13, 1400, "open2", 5), spend("pay2", 13, 1500, "open2", 0),
  spend("refund3", 14, 1600, "open3", 3),
];
const empty = (): DeliveryTally => ({ escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] });
const tallyOf = (txs: typeof history) => { const tally = empty(); tallyDelivery(txs as never, new Set([SELLER]), UNIT, CONTRACT, tally); return tally; };
const counts = (t: DeliveryTally) => ({ opened: t.escrowsOpened, submitted: t.resultsSubmitted, paid: t.paid, refunded: t.refunded, disputed: t.disputed });

test("fixture sanity: the full history has the counts the merge test depends on", () => {
  const full = tallyOf(history);
  assert.deepEqual(counts(full), { opened: 25, submitted: 2, paid: 2, refunded: 1, disputed: 0 });
});

test("merged tally equals the full scan: index up to a block plus later txs, nothing counted twice", () => {
  const full = tallyOf(history);
  const finished = tallyOf(history);
  toIndexed(finished, 14, "t"); // finishes the reference tally the same way the index does
  const indexedPart = toIndexed(tallyOf(history.filter((tx) => tx.block_height <= 12)), 12, "2026-10-07T00:00:00Z");
  const merged = mergeIndexed(indexedPart, tallyOf(history.filter((tx) => tx.block_height > 12)));
  assert.deepEqual(counts(merged), counts(full));
  assert.deepEqual(merged.responseSeconds, [300, 60], "submit2 (block 13) answers open2 (block 11, in the index): carried via openPending");
  assert.equal(merged.responseSecondsMedian, finished.responseSecondsMedian);
  assert.equal(merged.responseSecondsP90, finished.responseSecondsP90);
  assert.deepEqual(merged.events.slice(0, 20).map((e) => e.txHash), finished.events.slice(0, 20).map((e) => e.txHash));
});

test("deliveryHistory reads the index and live-scans only txs after scannedThroughBlock", async () => {
  const indexedPart = toIndexed(tallyOf(history.filter((tx) => tx.block_height <= 12)), 12, "2026-10-07T00:00:00Z");
  const index: EscrowIndex = { network: "Mainnet", generatedAt: "2026-10-07T00:00:00Z", agents: { [UNIT]: indexedPart } };
  setEscrowIndexForTests(index);
  const byHash = new Map(history.map((tx) => [tx.tx_hash, tx]));
  const requestedTxs: string[] = [];
  let afterBlock: number | undefined;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (url.includes("/asset_info")) return json([{ minting_tx_hash: "mint" }]);
    if (url.includes("/asset_addresses")) return json([]);
    if (url.includes("/address_txs")) {
      if (!url.includes("offset=0")) return json([]);
      afterBlock = body._after_block_height;
      // koios is inclusive: block 12 (already in the index) comes back too.
      return json(body._addresses[0] === CONTRACT ? history.filter((tx) => tx.block_height >= body._after_block_height).map((tx) => ({ tx_hash: tx.tx_hash, block_height: tx.block_height })) : []);
    }
    if (url.includes("/tx_info")) {
      if (body._tx_hashes[0] === "mint") return json([{ block_height: 5 }]);
      requestedTxs.push(...body._tx_hashes);
      return json(body._tx_hashes.map((hash: string) => byHash.get(hash)));
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  try {
    const evidence = await deliveryHistory(UNIT, "Mainnet");
    assert.equal(evidence.status, "ok");
    const data = evidence.data as Record<string, any>;
    assert.deepEqual(requestedTxs.sort(), ["pay2", "refund3", "submit2"], "only txs strictly after block 12 are fetched");
    assert.equal(afterBlock, 12);
    assert.deepEqual({ paid: data.paid, refunded: data.refunded, resultsSubmitted: data.resultsSubmitted, escrowsOpened: data.escrowsOpened }, { paid: 2, refunded: 1, resultsSubmitted: 2, escrowsOpened: 25 });
    assert.equal(data.indexedThroughBlock, 12);
  } finally { globalThis.fetch = real; setEscrowIndexForTests(undefined); }
});
