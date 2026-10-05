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

## Follow-up round (critic: 1440 pass, 375 fail)

Re-run on a fresh production build at 375x812 and 1440x900 (tab brought to front so transitions run). The same 4-scenario script: 8 of 8 scenarios match the router (winner and total), 9 rows each, 0 mismatches, scrollW equals innerWidth, 0 console errors.

| Item | Before | After (DOM read) |
|---|---|---|
| Default | bot + independent, tie among three 20.00 routes | treasury + shared, unique winner underwritten seller-b 25.90 (`input[name=buyer]:checked` = treasury, switch aria-checked = true) |
| Tie-break | none | bot + independent: "Tied with single Seller B at 20.00; chosen because its loss swing is 14.00 vs 30.00 ADA." Treasury + independent states the exact-twin case (B+C, same 14.00 swing, broken by name). Treasury + shared and bot + shared have no tie and render no tie text |
| 375 order | controls, then numbers far below | h1 at y=125, hero pair at y=223, controls at y=642; first figures at y=314 (above the 812 fold) |
| Mobile ranking | 9 rows | 3 visible of 9, button "Show all 9 routes" toggles to 9 visible and "Show the top 3 routes only" |
| Hero numbers | route names | Paid / true cost 10.00 / 25.90 vs 8.00 / 38.00, from the live response, 56px at 375 and 92px at 1440, tabular |
| Names | seller-a, koios-shared | "Seller A", "Seller B" from the router name field; provider shown as "Shared Koios node" / "Own node" |
| Plain words | riskAversion 0 / 0.25 first | "Can absorb a loss" / "Cannot absorb a loss", riskAversion small underneath; keeper defined above the h1; "Typical swing"; the starting-assumption gloss under the prior; arithmetic rounded to 2 decimals ("10.00 + 8.60 + (0.10 * 100.00 - 0.08 * 80.00) + 0.25 * 14.80") |
| Paths | absolute path printed in the empty run state | no `/Users/` in the page text; command `bun run agents/buyer.ts` shown only when `agents/buyer.ts` exists |
| Bars | re-created, grow from 0 | same element per route (node identity kept), single seller-b bar 501.9px to 365px in 280ms, never 0 (samples 459.6, 391.6, 372.3, 366.7, 365.2, 365); disabled under prefers-reduced-motion |
| Nav targets | 21px | 44px, 44px, 44px |
| Run section | guessed field names, synthetic fixture used in QA | parser rewritten to the real record shape `{startedAt, selectedRoute, records[{step, txHash, confirmed, error, detail}]}` read from `agents/buyer.ts`; no synthetic data is shipped or rendered; `agents/runs` is empty so the section shows the command |

Blind spots: the run section has still not rendered a real record, and a tab in the background freezes CSS transitions (the first animation sample was invalid until the tab was foregrounded).
