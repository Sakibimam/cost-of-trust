# Cost-of-Trust web: DESIGN.md

Binding for everything under `web/`. Tokens live in `src/app/globals.css` (`@theme`), never inline in components.

## Theme: Hallmark `Grid`

Genre: modern-minimal. Macrostructure: **Route Board** (a departure board for counterparties: one ruled column of ranked rows, a decision header above it, an evidence ledger below).

Why Grid, and not a dark ledger or a cream editorial page:

- The screen's argument is a ranking. Grid is the catalog theme built for ruled rows, hard rectangles and signage typography, so a bar is a bar and a rank is a rank. Zero radius and zero shadow keep every segment of the stacked bars readable as a measurement.
- Grid's three signal colours map one to one onto the cost components the page decomposes: ink for price, blue for premium, signal red for expected loss, signal yellow (surface only, hatched) for the risk charge. Colour carries the argument; it is not decoration.
- It differs from the last eight entries in the design log on paper band (cool near-white, where recent runs were cream or near-black), display face (Archivo 800, new), accent hue (blue 258, where recent runs were cyan, ochre, rust, red) and macrostructure.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--color-paper` | `oklch(99% 0.003 255)` | page |
| `--color-paper-2` | `oklch(97.2% 0.004 255)` | ledger bands, hover |
| `--color-paper-3` | `oklch(94.5% 0.005 255)` | pressed, track |
| `--color-ink` | `oklch(16% 0.010 255)` | text, price segment, rules that matter |
| `--color-muted` | `oklch(44% 0.012 255)` | secondary text (7:1 on paper) |
| `--color-rule` | `oklch(88% 0.004 255)` | hairlines |
| `--color-blue` | `oklch(46% 0.19 258)` | premium segment, links, focus ring |
| `--color-signal` | `oklch(55% 0.21 28)` | expected-loss segment, rejected marks |
| `--color-signal-ink` | `oklch(46% 0.19 28)` | signal-coloured text (5.9:1) |
| `--color-yellow` | `oklch(82% 0.17 95)` | risk-charge segment, fill only, never text |

Ink on yellow is the only text pairing allowed on yellow.

## Type

One family: **Archivo** (400, 500, 600, 800) via `next/font/google`. No Inter, Roboto, Arial, Open Sans.

| Role | Size | Weight | Tracking | Line height |
|---|---|---|---|---|
| Display | `clamp(40px, 5.6vw, 84px)` | 800 | -0.045em | 0.92 |
| Section head | `clamp(26px, 2.6vw, 40px)` | 800 | -0.03em | 1 |
| Lede | 18px | 400 | 0 | 1.45 |
| Body | 16px | 400 | 0 | 1.5 |
| Figure | 15px | 600 | 0 | 1.2, `tabular-nums` |
| Label | 12px | 600 | 0.09em, uppercase | 1.2 |

All numbers use `font-variant-numeric: tabular-nums`. ADA is shown to two decimals.

## Space and shape

4pt scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Radius 0 everywhere except the round radio dot. Shadow none. Rules are 1px `--color-rule`; the decision header and the selected row use a 6px ink bar. Page measure 1280px with 24px gutters (16px under 480px).

The 12-column rule overlay is used behind the hero only, at 768px and above. Under 768px it is removed.

## Components

- **Segmented control** (`role="radiogroup"`, native `input type="radio"` visually restyled): 44px tall, ink fill when checked, blue 3px focus ring offset 2px, never animated in.
- **Switch** (`role="switch"` button): 44px tall target, square thumb, label is the visible text, state echoed in text ("on" / "off").
- **Route row**: rank, label with route-id word, stacked bar on a shared ADA axis, total at the right. Under 768px the bar drops below the label and the four figures sit under the bar.
- **Bar segments**: price ink, premium blue, expected loss signal, risk charge yellow with a 45 degree ink hatch. 1px paper gaps between segments. Each row also prints the four numbers as text, so colour is never the only carrier.
- **Record bar** (seller ledger): hatched prior pseudo-trials, then successes in ink, failures in signal. The hatch is labelled as the configured prior.
- **States**: every fetch has loading (named endpoint and a hairline progress rule), empty, and error (endpoint, message, retry button, the command that starts the router).

## Motion

Opacity and transform only. Bars grow on `transform: scaleX` from the left, 280ms `cubic-bezier(0.16, 1, 0.3, 1)`, only when the route set changes. Everything is disabled under `prefers-reduced-motion: reduce`. No `transition-all`.

## Bans carried from the lane preamble

No purple or violet, no blue-to-pink gradients, no three equal feature cards, no centred hero plus three cards, no emoji icons, no stat grid, no em dashes in visible copy, no filler words (Seamless, Elevate, Unleash).
