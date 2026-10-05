import { applyParamsToScript, validatorToAddress, validatorToScriptHash, type MintingPolicy, type Network, type SpendingValidator } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Constr } from "@lucid-evolution/lucid";
export type OutRef = { txHash: string; outputIndex: number };
type V = { title: string; compiledCode: string };
type Blueprint = { validators: V[] };
export function loadBlueprint(path = process.env.COT_BLUEPRINT ?? resolve(import.meta.dirname, "../../onchain/plutus.json")): Blueprint { return JSON.parse(readFileSync(path, "utf8")) as Blueprint; }
const code = (title: string) => { const v = loadBlueprint().validators.find((x) => x.title === title); if (!v) throw new Error(`missing blueprint validator ${title}`); return v.compiledCode; };
const ref = (r: OutRef) => new Constr(0, [r.txHash, BigInt(r.outputIndex)]);
export const claimVaultScript = (): SpendingValidator => ({ type: "PlutusV3", script: code("claim_vault.claim_vault.spend") });
export const configPolicy = (seed: OutRef): MintingPolicy => ({ type: "PlutusV3", script: applyParamsToScript(code("config_nft.config_nft.mint"), [ref(seed)]) });
export const coverageScript = (policyId: string): SpendingValidator => ({ type: "PlutusV3", script: applyParamsToScript(code("coverage.coverage.spend"), [policyId]) });
export const scriptAddress = (network: Network, validator: SpendingValidator) => validatorToAddress(network, validator);
export const scriptHash = validatorToScriptHash;
