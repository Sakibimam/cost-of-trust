# QA evidence

Run against `next start -p 3100` (production build, `bun run build` exit 0, zero build warnings) and the live router at `http://localhost:8787`, in the `deepsurge` Brave profile. Viewports were applied with CDP `Emulation.setDeviceMetricsOverride` (375x812 mobile, 1440x900) and confirmed by `innerWidth`. Every DOM read below came from the running page, not from the source.

## The 2x2, at both widths

Each scenario clicks the real controls, waits for the re-query to settle, then compares the page against a fresh `POST /best-route` made from the same tab (loss 100, candidates from `GET /sellers`, `allowRedundancy` true).

| Buyer | Keepers | Page selected | Router selected | Risk-adjusted ADA | 375 | 1440 |
|---|---|---|---|---|---|---|
| Risk-neutral bot (0) | independent | redundant seller-a+seller-b | same | 20.00 | match | match |
| Risk-neutral bot (0) | shared | single seller-b | same | 20.00 | match | match |
| Treasury (0.25) | independent | redundant seller-a+seller-b | same | 23.50 | match | match |
| Treasury (0.25) | shared | underwritten seller-b | same | 25.90 | match | match |

Per scenario and width: 9 rows rendered for 9 routes returned; for every row the displayed risk-adjusted total and the four printed figures (price, premium, expected loss, risk charge) equal the router response to 2 decimals (0 mismatches over 72 row checks); the selected bar's width fraction equals risk-adjusted cost over the axis max (0.500, 0.500, 0.587, 0.647 against 0.500, 0.500, 0.588, 0.648); the reason sentence equals the router's `reason`; `document.documentElement.scrollWidth` equals `innerWidth` (375 and 1440), so there is no horizontal scroll.

Negative control: the same script with the router request deliberately sent the opposite `riskAversion` reports 18 mismatches per scenario and different winners, so the comparison is able to fail.

## States

- Loading: server-rendered HTML contains "Asking http://localhost:9/best-route ..." with a progress rule before hydration.
- Error: a second instance built against an unreachable router URL renders `role="alert"`: "The router did not answer.", the URL, the router's message, the start command and an "Ask again" button, at 375 and 1440, no horizontal scroll.
- Empty runs: `agents/runs` has no record yet, so the run section shows the exact command that produces one (`DEMO_LOSS_ADA=10 bun run agents/buyer.ts`).
- Run parser: exercised with a synthetic record in a temp directory (`RUNS_DIR`), which is a QA fixture and not shipped. It rendered 2 transactions with Cardanoscan preprod links, one `confirmed` and one `pending` (signal colour), and the outcome rows. A real record from `agents/runs` is not yet available to confirm its field names.

## Console

0 `Runtime.exceptionThrown` from the page and 0 console errors across the 8 scenarios. Superseded requests are cancelled by `AbortController` (reported by the browser as `net::ERR_ABORTED, canceled`), which is intentional and not an error. A wallet extension script (`evmAsk.js`) in the profile throws its own exceptions and is excluded.

## Typography

Archivo 400, 500, 600 and 800 are loaded (`document.fonts`). Tabular figures: `1111.11` and `0000.00` in `.fig` measure the same width (56.62px).

## Gates

- `uicraft gate --cwd web` exits 0 (0 high findings, 10 files). Break check: adding a file with an em dash, `transition-all`, a purple-to-pink gradient and filler verbs made it exit 1 with 4 high findings; removing the file returned it to 0.
- `uicraft look --url http://localhost:3100/` exits 0 with `tells=[]`.

Blind spots: Koios and Cardanoscan links are not followed (no real evidence or run transactions exist yet); a keyboard-only pass was not run beyond native radio and button semantics; Safari and Firefox were not opened.
