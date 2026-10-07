# Chainlink CRE: simulation and settlement evidence

Cost of Trust uses a Chainlink CRE workflow, `cot-adjudicator`, as the referee for underwritten jobs. When a buyer buys a job "with cover", an underwriter locks collateral in a coverage UTxO on Cardano. The workflow reads the coverage and task UTxOs from Cardano preprod through Koios, decides SUCCESS or FAILURE with deterministic rules, and has the DON sign a report. A Plutus V3 validator on Cardano verifies that signed report and pays out: the buyer on FAILURE, the underwriter on SUCCESS.

- Workflow source: [`cre/cot-adjudicator/main.ts`](cre/cot-adjudicator/main.ts) (decision rules in [`cre/cot-adjudicator/src/`](cre/cot-adjudicator/src/))
- Workflow config: [`cre/cot-adjudicator/workflow.yaml`](cre/cot-adjudicator/workflow.yaml), [`cre/project.yaml`](cre/project.yaml)
- Simulation logs: [`cre/evidence/`](cre/evidence/) (11 runs, `simulate-<unix ms>.log`)
- Signed report captured from the simulation: [`cre/evidence/relayer-report.json`](cre/evidence/relayer-report.json), [`raw_report.json`](cre/evidence/raw_report.json), [`report_context.json`](cre/evidence/report_context.json), [`sigs.json`](cre/evidence/sigs.json)

## 1. Successful simulation with the CRE CLI

`cre workflow simulate` (CRE CLI 1.36.0), staging target, HTTP trigger with a real preprod coverage and task reference. Terminal output from the run on 2026-10-07, [`cre/evidence/simulate-1791345634542.log`](cre/evidence/simulate-1791345634542.log):

```
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ...
  Binary hash: 6a5268ca2fb0bb806d183c11997a42b818760936a3663ec22103d8ff6b741c6a
  Config hash: d9c041c2884b90ba656aa2b0e4dd0d176409afb8d2b23854c440ded5355808dd
✓ Parsed JSON input successfully
✓ Created HTTP trigger payload with 2 fields
2026-10-07T09:30:32Z [SIMULATION] Simulator Initialized

2026-10-07T09:30:32Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
╭────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Handler requested TEE Execution                                                                    │
│ The simulator is not a real TEE, and is meant to debug.                                            │
│ Do not use it for sensitive information.                                                           │
│ During real execution, user logs for this trigger will not be visible, and will not leave the TEE. │
│ They are presented in the simulator for debugging only.                                            │
╰────────────────────────────────────────────────────────────────────────────────────────────────────╯

2026-10-07T09:30:34Z [USER LOG] decision FAILURE: 200

✓ Workflow Simulation Result:
"{\"report\":true,\"decision\":\"FAILURE\",\"delivered\":true}"

2026-10-07T09:30:34Z [SIMULATION] Execution finished signal received
╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
╰──────────────────────────────────────────────────────╯
```

Both outcomes are exercised. The SUCCESS path, from [`cre/evidence/simulate-1791262466048.log`](cre/evidence/simulate-1791262466048.log):

```
  Binary hash: d1c1f8febcbacae0be3e13ab82dd5298948c574b3d85abe8fffa80f279e064db
2026-10-06T10:24:22Z [SIMULATION] Simulator Initialized
2026-10-06T10:24:25Z [USER LOG] decision SUCCESS: 200
✓ Workflow Simulation Result:
"{\"report\":true,\"decision\":\"SUCCESS\",\"delivered\":true}"
```

`delivered: true` means the DON-signed report reached the relayer (HTTP 200), which saved the raw report, report context and signatures to `cre/evidence/`.

## 2. Confidential portion (TEE)

The trigger handler is registered with `handlerInTee`, so it runs as a Confidential Workflow:

```ts
export const initWorkflow = (config: Config) => [handlerInTee(new HTTPCapability().trigger({}), onTrigger, {})];
```

Inside the TEE handler:

- **Secret stays inside the enclave.** The Koios API key is a CRE secret (`KAIOS_KEY`, mapped in [`secrets.yaml`](cre/cot-adjudicator/secrets.yaml) to `CRE_KAIOS_KEY`) read with `runtime.getSecret(...)` and used only as the bearer on the Koios requests. It is never logged, returned or written to the report.
- **Chain reads under consensus.** Each node reads the coverage and task UTxOs from Koios in `runInNodeMode`, and the nodes agree on the canonical JSON outcome with `consensusIdenticalAggregation`.
- **Signed report.** `runtime.reportFromDon(...)` produces the ECDSA-signed report (keccak256), which the handler delivers to the relayer.

The simulator output above shows the CLI honouring the TEE request ("Handler requested TEE Execution"), and the `ConfHTTP` limits line shows the confidential HTTP budget applied to the run.

## 3. The simulated report settles on Cardano

The report the simulation signed is the one Cardano verifies. The raw report in [`relayer-report.json`](cre/evidence/relayer-report.json) carries the coverage UTxO (`9dc6f137...`) and task UTxO (`cf2a4198...`) it was cut for, and the preprod run [`agents/runs/2026-10-07T04-02-54-740Z.json`](agents/runs/2026-10-07T04-02-54-740Z.json) spends that coverage UTxO with it:

| Step | Preprod transaction |
| --- | --- |
| Config NFT (signer allowlist, f, workflow identity, DON config digest) | [f46171f2...d7cf7fc2](https://preprod.cardanoscan.io/transaction/f46171f2855035ec7c9a0505b0b4f48cf178f17546476217949d8769d7cf7fc2) |
| Task UTxO | [cf2a4198...7736c79d](https://preprod.cardanoscan.io/transaction/cf2a4198860272c11732c732bd18363b45f079217dec79116eead1f67736c79d) |
| Coverage lock (underwriter collateral) | [9dc6f137...c4e77de0d704](https://preprod.cardanoscan.io/transaction/9dc6f13768859de0ab39e36585a9aa660cae7973f39d54440697c4e77de0d704) |
| Coverage settled by the CRE report | [3e33929d...8526ff1b](https://preprod.cardanoscan.io/transaction/3e33929dbf296722029680f3ff26676da5b420ebe4e4e34265b9992a8526ff1b) (1569 confirmations on Koios, read 2026-10-07) |
| Same report with the decision byte flipped | Rejected by the validator: `failed script execution Spend[1] the validator crashed / exited prematurely` |

The Plutus V3 coverage validator checks f+1 distinct secp256k1 signatures from the allowlisted signer set, the DON config digest, the workflow identity, the task and terms binding, and the settlement window before it releases collateral. Changing one byte of the decision breaks the signatures, and the ledger refuses the spend.

## Reproduce

```sh
cd cre/cot-adjudicator && bun install && bun test        # pure decision tests
bun ../tools/sink.ts &                                    # relayer sink, writes cre/evidence/
cre workflow simulate cot-adjudicator --target staging-settings \
  --http-payload '{"coverageRef":"<tx>#<i>","taskRef":"<tx>#<i>","termsHash":"<64 hex>"}'
```

Set `CRE_KAIOS_KEY` in your environment first; the workflow reads it as the `KAIOS_KEY` secret.
