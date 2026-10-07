import type { Metadata } from "next";
import { buildDeckData } from "./data";
import { DeckShell } from "./slides";

export const metadata: Metadata = {
  title: "Cost of Trust deck",
  description: "An agent pays Trust Check over x402 before it hires another agent. The answer is hire, hire a backup, or do not hire.",
};

export default function DeckPage() {
  return <DeckShell data={buildDeckData()} />;
}
