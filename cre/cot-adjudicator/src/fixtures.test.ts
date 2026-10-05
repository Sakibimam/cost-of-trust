import { expect, test } from "bun:test";
import { decide } from "./decide";

const fixture = await Bun.file(new URL("../../fixtures/koios-live.json", import.meta.url)).json() as any;
test("recorded Koios fixture contains the real spent and unspent lanes", () => {
  expect(fixture.source).toContain("preprod.koios.rest");
  expect(fixture.spentBeforeExpiry.lockTxInfo[0].tx_hash).toBe("c9a8339b6e51bc86a1437fecd6f130647ed20a20ef238001a9c9dfd5711b47bc");
  expect(fixture.spentBeforeExpiry.spendingTxInfo[0].tx_hash).toBe("c85a1fdc4d271df2d668fd97c28903e18cef9a8cff9c496bf16b2487d4df69df");
  expect(fixture.unspent.addressUtxos.length).toBeGreaterThan(0);
});
test("recorded real lanes feed the three decision classes", () => {
  expect(decide({ coverageLockTime: 1_700_000_000_000, decideBy: 1_700_000_600_000, expiry: 1_700_000_300_000, now: 1_700_000_200_000, blocksInWindow: 2, spend: { txHash: fixture.spentBeforeExpiry.spendingTxInfo[0].tx_hash, blockTime: 1_700_000_100_000, paysBeneficiary: true, signedBySponsor: false, kind: "claim" } }).decision).toBe("SUCCESS");
  expect(decide({ coverageLockTime: 1_700_000_000_000, decideBy: 1_700_000_600_000, expiry: 1_700_000_300_000, now: 1_700_000_300_000, blocksInWindow: 2 }).decision).toBe("FAILURE");
  expect(decide({ coverageLockTime: 1_700_000_400_000, decideBy: 1_700_000_600_000, expiry: 1_700_000_300_000, now: 1_700_000_500_000, blocksInWindow: 2 }).decision).toBe("INCONCLUSIVE");
});
