# Cost-of-Trust CRE adjudicator

`cot-adjudicator` reads the coverage and claim UTxOs from Cardano preprod through Koios, applies the deterministic rules in section 7 of [`docs/SPEC.md`](../docs/SPEC.md), and sends a signed 67-byte report to the configured relayer.

The trigger is:

```json
{"coverageRef":"<tx-hash>#<index>","taskRef":"<tx-hash>#<index>","termsHash":"<64 hex characters>"}
```

Koios authentication is a CRE secret named `KAIOS_KEY`. The capture script reads `KAIOS_KEY` from the environment, records only real preprod JSON under `fixtures/`, and never prints or stores the key.

Run the pure decision tests with:

```sh
cd cre/cot-adjudicator
bun test
```

For a local simulation, start `bun cre/tools/sink.ts`, provide a real preprod trigger payload, and run `cre workflow simulate` with the staging target. The sink saves `raw_report.json`, `report_context.json`, and `sigs.json` under `cre/evidence/`. The signatures in those files come from the simulator's deterministic keys and are the vector for the onchain lane.
