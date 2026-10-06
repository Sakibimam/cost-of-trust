# State (updated 2026-10-06 20:20 SGT)

## Proven (with evidence)
- Validators: 78/78 aiken tests; both security reviews fixed (onchain/SECURITY-FIXED.md).
- Router: 21 tests; live at https://cost-of-trust.vercel.app/api/router (4-case 2x2 verified by curl).
- Preprod runs (agents/runs/2026-10-06T04-*.json): underwritten success settle 5f44c119..., failure settle 54c5eb59..., redundant race (loser BadInputsUTxO), flipped report rejected.
- Trust Check Coworker 01a10fcf-eed2-75ed-a385-a979349eeb93 (vendor 01a10fcf-be3e-..., COT org connected GRANTED): paid Task 01a1103d... escrow a6e3fbda..., result 8c9db324..., seller collection 9c560b70... (1 tUSDM).
- Trust Check reports now real (Koios POST lookups, live router): recommendation "hire_with_backup_keeper", 7.49 ADA (commits 7b39763..11cbc98).
- Web fixes from live judge (fixA) deployed via vca kamal2.
- Deck: deck/cost-of-trust.pptx (10 slides). Judge FAQ, PITCH-90S.md, scripts/judge-demo.sh (grok lanes).
- Instant x402 code: instant/ with pricing + verify gate tests (mutation proven).
- Worker fix 3: free-text Masumi asset/policy extraction, usage completion, per-task FAILED handling; tests pass and mutation test went red then green.
- Stuck Sokosumi tasks cleared: 01a110f9 completed with help, 01a11089 and 01a1102c failed explicitly.
- Report server detached on PID 18678 at :8788; patched worker detached on PID 18679. The fresh payment request remains externally funded on chain but the Task has no terminal result yet.
- Fixes 2 and 5 deployed: forged-report settlement copy now names the on-chain rejection and settlement tx context; seller endpoints now expose preprod keeper labels, registry ids, and payout addresses rather than loopback URLs.

## Broken / blocked
- Trust Check fresh paid Task 01a1111b-318d-75de-a7e5-02edc5070204 is RUNNING. Local MPS accepted the request but reports WaitingForExternalAction with no on-chain state, so escrow/result/collection txs are not yet proven. Do not publish a fabricated verdict row or tx link.
- Instant x402 live benchmark: complete with one confirmed 45-output split transaction, 20 confirmed-mode requests, 20 instant-mode requests, all 40 payment hashes confirmed by Koios, and a conflicting-input refusal. The seller spent-input check now rejects Koios rows marked `is_spent=true`.
- No GitHub remote (HUMAN: approve public repo).
- Vercel env KAIOS_KEY missing on cost-of-trust (HUMAN) (only /ingest needs it).
- Last live-judge score 49/100 (before fixA).
