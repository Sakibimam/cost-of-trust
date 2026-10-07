import { expect, test } from "bun:test";
import { checkpointDecision } from "./staggered";

const ref = { txHash: "a".repeat(64), outputIndex: 0 };
const fakeFetch = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

test("spent checkpoint skips B", async () => {
  expect(await checkpointDecision(ref, "claim", fakeFetch([]), "http://koios")).toBe("backup_not_needed");
});

test("unspent checkpoint pays B", async () => {
  expect(await checkpointDecision(ref, "claim", fakeFetch([{ tx_hash: ref.txHash, tx_index: 0 }]), "http://koios")).toBe("backup_engaged");
});
