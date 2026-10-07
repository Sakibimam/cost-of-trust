import type { SliderRow } from "./data";

export type RouteKey = "single" | "staggered" | "redundant" | "underwritten";

// Display order follows the buyer's choices. Glosses repeat KIND_GLOSS and routeGloss in web/src/lib/router.ts.
export const ROUTES: Array<{ key: RouteKey; name: string; short: string; gloss: string; pays: string; col: 3 | 4 | 5 | 6 }> = [
  { key: "single", name: "Hire alone", short: "Hire alone", gloss: "one keeper, no backup and no cover", pays: "You pay the one keeper. If it misses, the loss is yours.", col: 3 },
  { key: "staggered", name: "Hire with a backup, paid only on a missed checkpoint", short: "Backup on a missed checkpoint", gloss: "two keepers, one after the other, one claim and one fee", pays: "Keeper A gets the first window. Keeper B is paid only if the claim vault is still unspent at the checkpoint. The chain lets exactly one claim through.", col: 5 },
  { key: "redundant", name: "Hire plus a backup up front", short: "Backup up front", gloss: "two keepers, either one can finish the job", pays: "Both keepers are paid at the start. Either can finish the job and the ledger lets one claim through.", col: 4 },
  { key: "underwritten", name: "Hire with coverage", short: "Hire with coverage", gloss: "one keeper, with an insurer paying out if it fails", pays: "One keeper plus underwriter collateral. A signed FAILURE report from the CRE workflow pays the buyer.", col: 6 },
];

export function verdict(row: SliderRow): { label: string; route: RouteKey } {
  const route = row[2] as RouteKey;
  const r = ROUTES.find((x) => x.key === route);
  if (row[1] === "hire_as_is") return { label: "Hire alone", route: "single" };
  if (row[1] === "do_not_hire") return { label: "Do not hire", route };
  return { label: r ? r.name : route, route };
}

export const costOf = (row: SliderRow, key: RouteKey) => row[ROUTES.find((r) => r.key === key)!.col];
