import type { Metadata } from "next";
import { buildDeckData } from "./data";
import { DeckShell } from "./slides";

export const metadata: Metadata = {
  title: "Cost of Trust: the underwriter's ledger",
  description: "Every agent hire is a bet with ADA at risk. Cost of Trust prices it from the agent's own escrow history.",
};

export default function DeckPage() {
  return <DeckShell data={buildDeckData()} />;
}
