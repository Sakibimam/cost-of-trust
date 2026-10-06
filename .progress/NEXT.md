# Next (top = do first)

1. HUMAN/BLOCKED: fund MPS payment request for Task 01a1111b-318d-75de-a7e5-02edc5070204, then let worker submit the report and poll ResultSubmitted plus seller collection before adding the Knight row to the site.
2. BLOCKED: rerun the instant x402 benchmark from fresh confirmed buyer UTxOs after the submitted failed-run payments settle. Koios transport and seller field/serialization issues are fixed; current evidence is the spent-input rejection in `instant/results.json`. Then verify 40 confirmed hashes, p50/p95, and double-spend.
3. Re-score the live site with demo-judge after the current deployment; fix 4 remains gated on the new paid txs.
4. Record demo video (deck/demo.mp4, <= 3:00) following docs/DEMO-SCRIPT.md with the Trust Check band and the 2x2 toggle; embed in deck/cost-of-trust.pptx.
5. Add Instant x402 results + Trust Check evidence to README first 20 lines and the deck.
8. HUMAN: add KAIOS_KEY to Vercel project cost-of-trust (kamal2); redeploy with vca.
9. Submit on BuilderBase (main + Cardano + CRE) with repo, live URL, .pptx on Google Drive, video.
