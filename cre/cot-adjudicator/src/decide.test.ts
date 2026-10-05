import { describe, expect, test } from "bun:test";
import { buildBody, decide } from "./decide";

const base = { coverageLockTime: 1_700_000_000_000, decideBy: 1_700_000_600_000, expiry: 1_700_000_300_000, now: 1_700_000_200_000, blocksInWindow: 10 };
const spend = (kind: "claim" | "forfeit" | "other", extra: Partial<NonNullable<Parameters<typeof decide>[0]["spend"]>> = {}) => ({ txHash: "aa".repeat(32), blockTime: 1_700_000_100_000, paysBeneficiary: kind === "claim", signedBySponsor: kind === "forfeit", kind, ...extra });

describe("coverage adjudication", () => {
  test("SUCCESS from a beneficiary-paying claim before expiry", () => expect(decide({ ...base, spend: spend("claim") }).decision).toBe("SUCCESS"));
  test("FAILURE from an unspent claim after expiry", () => expect(decide({ ...base, now: base.expiry, spend: undefined }).decision).toBe("FAILURE"));
  test("INCONCLUSIVE when the chain has halted", () => expect(decide({ ...base, blocksInWindow: 0, now: base.expiry }).decision).toBe("INCONCLUSIVE"));
  test("FAILURE from a buyer-signed forfeit", () => expect(decide({ ...base, spend: spend("forfeit") }).decision).toBe("FAILURE"));
  test("the report body is exactly 67 bytes and big-endian", () => {
    const body = buildBody("11".repeat(32), "FAILURE", "22".repeat(32), 513);
    expect(body.length).toBe(67);
    expect(Buffer.from(body).toString("hex")).toBe("11".repeat(32) + "01" + "22".repeat(32) + "0201");
  });
});
