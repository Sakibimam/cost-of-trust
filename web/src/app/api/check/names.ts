import registryNames from "../../../../../coworker/src/registry-names.json";
import escrowIndex from "../../../data/escrow-index.json";

export type Entry = { identifier: string; network: string; name: string };
export type Indexed = {
  paid: number;
  refunded: number;
  disputed: number;
  responseSecondsMedian: number | null;
  responseSecondsP90: number | null;
  waits: Array<{ at: number; seconds: number }>;
  ceilingSeconds?: number[];
};

export const entriesByName = registryNames.names as Record<string, Entry[]>;
export const indexed = (id: string) => (escrowIndex.agents as Record<string, Indexed>)[id];
export const jobs = (id: string) => { const a = indexed(id); return a ? a.paid + a.refunded + a.disputed : 0; };

export const allEntries: Entry[] = Object.values(entriesByName).flat();
export const byId = new Map(allEntries.map((entry) => [entry.identifier, entry]));

// One display name per registry name, most active first, for the form's suggestion list.
export function agentNames(): string[] {
  return Object.values(entriesByName)
    .map((list) => [...list].sort((a, b) => jobs(b.identifier) - jobs(a.identifier))[0])
    .sort((a, b) => jobs(b.identifier) - jobs(a.identifier))
    .map((entry) => entry.name);
}
