"use client";
import { useEffect, useRef, useState } from "react";
import type { DeckData } from "./data";

export type SlideProps = { data: DeckData; active: boolean; run: number; reduced: boolean };

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function useRun(active: boolean): number {
  const [run, setRun] = useState(0);
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current) setRun((n) => n + 1);
    was.current = active;
  }, [active]);
  return run;
}

export function Tx({ data, id, className }: { data: DeckData; id: string; className?: string }) {
  const p = data.proofs.txs[id];
  if (!p) throw new Error(`deck: unknown proof id ${id}`);
  return (
    <a className={className} href={`${data.proofs.explorer}${p.txHash}`} target="_blank" rel="noreferrer" title={`${p.label} on preprod.cardanoscan.io`}>
      {p.txHash.slice(0, 8)}..{p.txHash.slice(-6)}
    </a>
  );
}

export const utc = (iso: string) => new Date(iso).toISOString().slice(11, 19);
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const ada = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const int = (n: number) => n.toLocaleString("en-US");
