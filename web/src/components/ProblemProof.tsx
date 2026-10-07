// Screenshots captured 2026-10-07 from the live pages linked in each caption.
export const PROBLEM_PROOF = [
  { img: "/proof/hn-x402-fidelity.png", w: 2060, h: 278, who: "dshaker on Hacker News", when: "Feb 2026", href: "https://news.ycombinator.com/item?id=47158809", point: "Monitoring about 1,700 x402 services: average fidelity 38/100. Agents need services worth paying for, not just services that are up." },
  { img: "/proof/x-chainlink-guardrails.png", w: 1236, h: 588, who: "Chainlink on X", when: "Sep 2026", href: "https://x.com/chainlink/status/2102799057999540510", point: "Agents are not transacting at scale without guardrails for reliable execution." },
  { img: "/proof/gh-2887.png", w: 1712, h: 1082, who: "x402 issue #2887", when: "Jul 2026", href: "https://github.com/x402-foundation/x402/issues/2887", point: "Nobody standardizes what happens when what an agent paid for turns out to be wrong." },
  { img: "/proof/x-masumi-dumb-rail.png", w: 1172, h: 554, who: "Masumi on X", when: "Aug 2026", href: "https://x.com/MasumiNetwork/status/2084348918360367445", point: "Put intelligence in the agents, not in the pipes: the buying decision belongs to the agent." },
  { img: "/proof/reddit-rpc-limits.png", w: 1738, h: 562, who: "oneAJ on r/ethdev", when: "2023", href: "https://www.reddit.com/r/ethdev/comments/169ujaw/anybody_else_having_trouble_with_rpc_providers", point: "One provider's limits stop every app on it at once: shared infrastructure fails together." },
] as const;

export function ProblemProof({ limit, className = "" }: { limit?: number; className?: string }) {
  return (
    <ul className={`m-0 grid list-none grid-cols-1 gap-6 p-0 md:grid-cols-2 ${className}`} aria-label="Builders describing the problem">
      {PROBLEM_PROOF.slice(0, limit).map((p) => (
        <li key={p.img} className="min-w-0">
          <figure className="m-0">
            <a href={p.href} rel="noreferrer" className="block border border-rule">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.img} width={p.w} height={p.h} alt={`${p.who}: ${p.point}`} loading="lazy" className="block h-auto w-full max-h-[340px] object-cover object-top" />
            </a>
            <figcaption className="mt-2 text-[14px] leading-snug"><span className="font-extrabold">{p.point}</span> <a href={p.href} rel="noreferrer" className="whitespace-nowrap text-muted">{p.who}, {p.when} ↗</a></figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
