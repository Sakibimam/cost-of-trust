import { lockClaimVault, lockCoverage, termsHash } from "@cost-of-trust/offchain";
import { context, config, refString } from "./common";
const sponsor = await context("admin2"), uw = await context("admin1"), buyer = await context("buyer");
const expiry = BigInt(Date.now() + 150_000);
const v = await lockClaimVault(sponsor.lucid, sponsor.deployment, { beneficiary: buyer.address, expiry, value: 3_000_000n });
const c = await lockCoverage(uw.lucid, uw.deployment, { buyer: buyer.address, payout: 3_000_000n, termsHash: termsHash({ probe: Date.now() }), taskRef: v.ref, taskExpiry: expiry, decideBy: expiry + 1_860_000n, config: config(), value: 5_000_000n });
console.log(JSON.stringify({ vault: refString(v.ref), coverage: refString(c.ref), expiry: String(expiry) }));
