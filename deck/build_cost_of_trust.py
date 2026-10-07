from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt


OUT = Path(__file__).with_name("cost-of-trust.pptx")
W, H = 13.333, 7.5
BG = RGBColor(0xF4, 0xF7, 0xF6)
INK = RGBColor(0x0B, 0x1F, 0x2A)
MUTED = RGBColor(0x5D, 0x70, 0x76)
CARD = RGBColor(0xFF, 0xFF, 0xFF)
TEAL = RGBColor(0x00, 0x8F, 0x86)
TEAL_DARK = RGBColor(0x06, 0x5B, 0x5C)
ORANGE = RGBColor(0xE6, 0x8A, 0x2E)
LINE = RGBColor(0xD5, 0xE2, 0xDF)
NAVY = RGBColor(0x0B, 0x2C, 0x3C)
MONO = "Courier New"
TITLE = "Trebuchet MS"
BODY = "Aptos"

prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
blank = prs.slide_layouts[6]


def slide():
    s = prs.slides.add_slide(blank)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = BG
    return s


def box(s, x, y, w, h, text="", size=18, color=INK, bold=False,
        font=BODY, align=PP_ALIGN.LEFT, fill=None, line=None, radius=0.08,
        margin=0.12, valign=MSO_ANCHOR.TOP):
    shape = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if fill else MSO_SHAPE.RECTANGLE,
                               Inches(x), Inches(y), Inches(w), Inches(h))
    if fill:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
        shape.adjustments[0] = radius
    else:
        shape.fill.background()
    if line:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    tf = shape.text_frame
    tf.clear()
    tf.word_wrap = True
    tf.margin_left = Inches(margin)
    tf.margin_right = Inches(margin)
    tf.margin_top = Inches(margin)
    tf.margin_bottom = Inches(margin)
    tf.vertical_anchor = valign
    p = tf.paragraphs[0]
    p.text = text
    p.font.name = font
    p.font.size = Pt(size)
    p.font.bold = bold
    p.font.color.rgb = color
    p.alignment = align
    return shape


def add_lines(shape, lines, size=15, color=INK, font=BODY, gap=5):
    tf = shape.text_frame
    for text, bold in lines:
        p = tf.add_paragraph()
        p.text = text
        p.font.name = font
        p.font.size = Pt(size)
        p.font.bold = bold
        p.font.color.rgb = color
        p.space_before = Pt(gap)
    return shape


def title(s, text, n, kicker=None):
    if kicker:
        box(s, 0.7, 0.28, 4.4, 0.28, kicker.upper(), 10, TEAL, True, MONO)
    box(s, 0.7, 0.58, 11.75, 0.68, text, 35, INK, True, TITLE)
    box(s, 0.7, 1.35, 1.15, 0.07, fill=TEAL)
    box(s, 0.7, 7.08, 8.4, 0.2, "COST OF TRUST  /  CARDANO AGENTIC COMMERCE", 9, MUTED, False, MONO)
    box(s, 12.0, 7.08, 0.6, 0.2, f"{n}/10", 9, MUTED, False, MONO, PP_ALIGN.RIGHT)


def label(s, x, y, text, color=TEAL):
    box(s, x, y, 1.7, 0.28, text.upper(), 10, color, True, MONO)


def tx_url(tx):
    return f"preprod.cardanoscan.io/transaction/{tx}"


# 1. Hook
s = slide()
box(s, 0.82, 0.5, 4.0, 0.3, "CARDANO AGENTIC COMMERCE", 11, TEAL, True, MONO)
box(s, 0.82, 1.55, 11.5, 1.35, "Agents can buy reliability,\nnot just access.", 38, INK, True, TITLE)
box(s, 0.82, 3.35, 8.5, 0.62, "We do not rank agents. We decide how to buy the job.", 24, TEAL_DARK, True)
box(s, 0.82, 4.6, 3.45, 1.05, "10 ADA\nservice price", 25, INK, True, TITLE, PP_ALIGN.CENTER, CARD, LINE, 0.12, 0.16, MSO_ANCHOR.MIDDLE)
box(s, 4.65, 4.6, 3.45, 1.05, "100 ADA\ndeadline loss", 25, ORANGE, True, TITLE, PP_ALIGN.CENTER, CARD, LINE, 0.12, 0.16, MSO_ANCHOR.MIDDLE)
box(s, 8.48, 4.6, 3.7, 1.05, "route before\npayment", 25, CARD, True, TITLE, PP_ALIGN.CENTER, TEAL_DARK, TEAL_DARK, 0.12, 0.16, MSO_ANCHOR.MIDDLE)
box(s, 0.82, 6.86, 11.5, 0.25, "Cost of Trust  |  how an agent buys a deadline job on Cardano", 11, MUTED, False, MONO)

# 2. Problem
s = slide(); title(s, "Price alone is the wrong decision rule.", 2, "the problem")
box(s, 0.7, 1.8, 5.55, 3.9, "", fill=CARD, line=LINE)
box(s, 1.05, 2.1, 4.85, 0.45, "A missed deadline destroys more value than the request costs.", 21, INK, True, TITLE)
for i, (head, body, color) in enumerate([
    ("Seller price", "10 ADA", TEAL),
    ("Observed delivery history", "failure posterior", INK),
    ("Infrastructure correlation", "independent or shared", INK),
    ("Buyer risk appetite", "absorb loss or protect tail", INK),
]):
    y = 2.9 + i * 0.62
    box(s, 1.05, y, 2.9, 0.42, head, 15, color, True)
    box(s, 4.05, y, 2.0, 0.42, body, 14, MUTED, False, MONO, PP_ALIGN.RIGHT)
box(s, 6.75, 1.8, 5.85, 3.9, "", fill=NAVY)
box(s, 7.15, 2.12, 4.9, 0.45, "The route is the product.", 25, CARD, True, TITLE)
for i, text in enumerate(["single", "redundant", "staggered", "underwritten"]):
    y = 2.95 + i * 0.52
    color = ORANGE if text == "single" else TEAL
    box(s, 7.15, y, 1.75, 0.35, text, 14, color, True, MONO)
    box(s, 9.0, y, 2.95, 0.35, ["cheap, exposed", "expensive, lower joint loss", "one spend, late backup", "coverage caps the tail"][i], 14, CARD)
box(s, 0.7, 6.15, 11.9, 0.45, "The router returns the eligible routes, their arithmetic, and the terms hash before the buyer pays.", 18, TEAL_DARK, True)

# 3. 2x2 map
s = slide(); title(s, "The buyer's route changes with risk and correlation.", 3, "selection map")
box(s, 0.85, 1.85, 3.0, 0.34, "BUYER RISK AVERSION", 11, MUTED, True, MONO)
box(s, 3.9, 1.82, 4.1, 0.4, "INDEPENDENT KEEPERS", 13, TEAL, True, MONO, PP_ALIGN.CENTER)
box(s, 8.2, 1.82, 4.1, 0.4, "SHARED INFRASTRUCTURE", 13, ORANGE, True, MONO, PP_ALIGN.CENTER)
# Source: docs/SPEC.md selection table.
rows = [
    ("0", "Staggered A > B\n11.10 ADA", "Staggered A > B\n18.24 ADA"),
    ("0.25", "Staggered A > B\n15.36 ADA", "Staggered B > A\n25.75 ADA"),
    ("0.5", "Staggered A > B\n19.63 ADA", "Underwritten B\n29.60 ADA"),
    ("1", "Staggered B > A\n27.71 ADA", "Underwritten B\n37.00 ADA"),
]
for i, (risk, ind, shared) in enumerate(rows):
    y = 2.4 + i * 0.92
    fill = CARD if i % 2 == 0 else RGBColor(0xEA, 0xF1, 0xEF)
    box(s, 0.85, y, 3.0, 0.78, risk, 22, INK, True, TITLE, PP_ALIGN.CENTER, fill, LINE, 0.08, 0.1, MSO_ANCHOR.MIDDLE)
    box(s, 3.9, y, 4.1, 0.78, ind, 16, TEAL_DARK, True, BODY, PP_ALIGN.CENTER, fill, LINE, 0.08, 0.1, MSO_ANCHOR.MIDDLE)
    box(s, 8.2, y, 4.1, 0.78, shared, 16, ORANGE, True, BODY, PP_ALIGN.CENTER, fill, LINE, 0.08, 0.1, MSO_ANCHOR.MIDDLE)
box(s, 0.85, 6.25, 11.45, 0.43, "Lowest risk-adjusted cost wins. Shared failure makes apparent redundancy less valuable.", 17, INK, True)

# 4. Route economics
s = slide(); title(s, "Two buyers. Same sellers. Different winners.", 4, "decision layer")
for x, head, sub, accent in [(0.75, "CAN ABSORB LOSS", "risk aversion 0  |  independent", TEAL), (6.72, "NEEDS TAIL PROTECTION", "risk aversion 0.5  |  shared", ORANGE)]:
    box(s, x, 1.75, 5.85, 3.95, "", fill=CARD, line=LINE)
    box(s, x + 0.35, 2.05, 5.15, 0.34, head, 12, accent, True, MONO)
    box(s, x + 0.35, 2.5, 5.15, 0.42, sub, 15, INK, True)
    if x < 1:
        rows2 = [("route", "staggered A > B"), ("service", "8.10 ADA expected"), ("risk-adjusted", "8.83 ADA")]
    else:
        rows2 = [("route", "underwritten B"), ("coverage", "10 ADA collateral"), ("risk-adjusted", "29.60 ADA")]
    for i, (k, v) in enumerate(rows2):
        y = 3.2 + i * 0.62
        box(s, x + 0.35, y, 1.5, 0.35, k, 13, MUTED, True, MONO)
        box(s, x + 2.0, y, 3.35, 0.35, v, 16, INK, True)
box(s, 0.75, 6.1, 11.82, 0.52, "risk-adjusted cost = service price + premium + expected loss + risk aversion × loss standard deviation", 16, TEAL_DARK, True, MONO, PP_ALIGN.CENTER)

# 5. Mechanism
s = slide(); title(s, "One deadline task. One spend. One winner.", 5, "cardano mechanism")
steps = [
    ("01", "Quote", "Router returns route, arithmetic, and terms hash."),
    ("02", "Lock", "Buyer creates one claim-vault UTxO."),
    ("03", "Race", "Buyer pays two keepers. Both submit a claim on that UTxO."),
    ("04", "Settle", "The ledger accepts the first claim and refuses the second: BadInputsUTxO."),
]
for i, (num, head, body) in enumerate(steps):
    x = 0.75 + i * 3.05
    box(s, x, 2.0, 2.65, 2.7, "", fill=CARD, line=LINE)
    box(s, x + 0.25, 2.25, 0.65, 0.34, num, 12, ORANGE, True, MONO)
    box(s, x + 0.25, 2.8, 2.1, 0.42, head, 23, INK, True, TITLE)
    box(s, x + 0.25, 3.45, 2.1, 0.88, body, 15, MUTED)
    if i < 3:
        box(s, x + 2.68, 3.05, 0.35, 0.35, ">", 22, TEAL, True, TITLE, PP_ALIGN.CENTER)
box(s, 0.75, 5.25, 11.82, 0.85, "Coverage is separate: CRE signs the task outcome. Plutus V3 checks its binding, signer threshold, DON digest, and settlement window.", 19, CARD, True, BODY, PP_ALIGN.CENTER, NAVY, NAVY, 0.1, 0.18, MSO_ANCHOR.MIDDLE)

# 6. Masumi comparison
s = slide(); title(s, "Masumi moves payment. Cost of Trust chooses the route.", 6, "positioning")
box(s, 0.85, 1.95, 5.45, 3.9, "", fill=CARD, line=LINE)
box(s, 1.2, 2.3, 4.7, 0.44, "MASUMI", 15, MUTED, True, MONO)
box(s, 1.2, 2.95, 4.6, 0.55, "Should this payment happen?", 23, INK, True, TITLE)
add_lines(box(s, 1.2, 3.7, 4.7, 1.5, "", size=16), [("Escrow, identity, reputation", False), ("Discovery and payment execution", False), ("Refund policy after the fact", False)], 16, MUTED)
box(s, 7.0, 1.95, 5.45, 3.9, "", fill=TEAL_DARK)
box(s, 7.35, 2.3, 4.7, 0.44, "COST OF TRUST", 15, RGBColor(0x9E, 0xE5, 0xD4), True, MONO)
box(s, 7.35, 2.95, 4.6, 0.75, "Which counterparty and which protection route, at what price?", 23, CARD, True, TITLE)
add_lines(box(s, 7.35, 3.9, 4.7, 1.4, "", size=16), [("Observed seller histories", False), ("Correlation-aware route choice", False), ("Terms hash before x402 payment", False)], 16, CARD)
box(s, 0.85, 6.25, 11.6, 0.4, "MIP-003-compatible keepers and x402 v2 Cardano exact payments stay in the flow.", 17, TEAL_DARK, True)

# 7. Provider probe
s = slide(); title(s, "Availability is a route input, not a footnote.", 7, "provider probe")
headers = [(0.72, 3.0, "PROVIDER"), (3.75, 0.75, "CALLS"), (4.55, 1.0, "SUCCESS"), (5.6, 0.95, "FAILURES"), (6.6, 1.2, "RATE"), (7.9, 1.15, "P50"), (9.1, 1.15, "P95")]
for x, w, h in headers:
    box(s, x, 1.9, w, 0.35, h, 10, MUTED, True, MONO)
# Source: docs/GTM.md and router/probes/results-20261006051159.json.
data = [
    ("Koios authenticated", "60", "60", "0", "100%", "394 ms", "485 ms", TEAL),
    ("Koios public keyless", "60", "0", "60 HTTP 429", "0%", "181 ms", "186 ms", ORANGE),
    ("Tatum Cardano preprod", "60", "60", "0", "100%", "318 ms", "750 ms", TEAL),
]
for i, row in enumerate(data):
    y = 2.35 + i * 0.75
    fill = CARD if i % 2 == 0 else RGBColor(0xEA, 0xF1, 0xEF)
    x = 0.72
    for j, val in enumerate(row[:-1]):
        w = [3.0, 0.75, 1.0, 0.95, 1.2, 1.15, 1.15][j]
        box(s, x, y, w, 0.57, val, 14 if j == 0 else 13, row[-1] if j == 0 or j == 4 else INK, j == 0 or j == 4, BODY if j == 0 else MONO, fill=fill, line=LINE, margin=0.08, valign=MSO_ANCHOR.MIDDLE)
        x += w + 0.04
box(s, 0.72, 5.1, 11.7, 1.0, "60 spaced preprod calls per endpoint. Every 429 and non-2xx response is a failure. A free endpoint still has a deadline cost.", 19, CARD, True, BODY, PP_ALIGN.CENTER, NAVY, NAVY, 0.1, 0.18, MSO_ANCHOR.MIDDLE)
box(s, 0.72, 6.35, 11.7, 0.3, "Source: router/probes/results-20261006051159.json", 11, MUTED, False, MONO)

# 8. Trust Check Coworker
s = slide(); title(s, "Trust Check turns diligence into an action.", 8, "coworker")
box(s, 0.75, 1.9, 4.15, 4.05, "", fill=NAVY)
box(s, 1.1, 2.25, 3.4, 0.34, "TRUST CHECK COWORKER", 12, RGBColor(0x9E, 0xE5, 0xD4), True, MONO)
box(s, 1.1, 2.85, 3.3, 0.8, "Should we hire\nthis agent?", 29, CARD, True, TITLE)
box(s, 1.1, 4.05, 3.35, 0.85, "Agent ID + task value at risk\nbecomes a cited report.", 17, RGBColor(0xD8, 0xED, 0xE7))
box(s, 1.1, 5.15, 3.35, 0.42, "hire  |  backup  |  coverage  |  do not hire", 12, RGBColor(0x9E, 0xE5, 0xD4), True, MONO)
for i, (head, body) in enumerate([
    ("1. Registry", "live identity and metadata"),
    ("2. History", "Masumi escrow records from Koios"),
    ("3. Health", "endpoint availability and health"),
    ("4. Route", "Cost of Trust quote and recommendation"),
]):
    y = 1.9 + i * 0.98
    box(s, 5.35, y, 6.95, 0.72, "", fill=CARD, line=LINE)
    box(s, 5.7, y + 0.13, 1.45, 0.3, head, 13, TEAL, True, MONO)
    box(s, 7.35, y + 0.13, 4.5, 0.34, body, 16, INK, True)
box(s, 5.35, 6.1, 6.95, 0.52, "Missing upstream data stays unavailable. The report cites the facts it can verify.", 15, TEAL_DARK, True, BODY, PP_ALIGN.CENTER)

# 9. Evidence
s = slide(); title(s, "The proof is live, confirmed, and inspectable.", 9, "preprod evidence")
box(s, 0.72, 1.8, 3.0, 0.36, "FOUR CONFIRMED RUNS", 11, TEAL, True, MONO)
# Source: agents/runs/2026-10-06T04-12-36-912Z.json through 2026-10-06T04-45-57-790Z.json.
evidence = [
    ("04:12", "underwritten", "claim vault + coverage settle", "f158c93d", "5f44c119"),
    ("04:23", "underwritten", "forfeit + coverage settle", "3f65613f", "54c5eb59"),
    ("04:35", "redundant A + B", "A claims, B refused by the ledger", "b26f22c3", "99fd62a1"),
    ("04:45", "underwritten", "seller B claims + coverage settle", "296257f1", "3c20440b"),
]
for i, (t, route, action, lock, settle) in enumerate(evidence):
    y = 2.35 + i * 0.82
    box(s, 0.72, y, 1.0, 0.6, t, 15, INK, True, MONO, PP_ALIGN.CENTER, CARD, LINE, 0.06, 0.05, MSO_ANCHOR.MIDDLE)
    box(s, 1.82, y, 2.05, 0.6, route, 14, TEAL_DARK, True, BODY, PP_ALIGN.CENTER, CARD, LINE, 0.06, 0.05, MSO_ANCHOR.MIDDLE)
    box(s, 4.0, y, 2.75, 0.6, action, 13, INK, False, BODY, fill=CARD, line=LINE, margin=0.08, valign=MSO_ANCHOR.MIDDLE)
    box(s, 6.95, y, 2.65, 0.6, f"lock  {lock}...", 12, MUTED, False, MONO, fill=CARD, line=LINE, margin=0.08, valign=MSO_ANCHOR.MIDDLE)
    box(s, 9.8, y, 2.7, 0.6, f"settle  {settle}...", 12, MUTED, False, MONO, fill=CARD, line=LINE, margin=0.08, valign=MSO_ANCHOR.MIDDLE)
box(s, 0.72, 5.95, 11.78, 0.62, "On-chain suite: 78 checks passed. A flipped report byte is rejected by the validator test suite.", 18, CARD, True, BODY, PP_ALIGN.CENTER, NAVY, NAVY, 0.1, 0.18, MSO_ANCHOR.MIDDLE)
box(s, 0.72, 6.72, 11.78, 0.25, "Full hashes and explorer links are recorded in docs/DECK.md.", 11, MUTED, False, MONO)

# Source: instant/results.json, generatedAt 2026-10-06T12:31:47.741Z.
# 10. Close
s = slide(); title(s, "Trust is a route choice.", 10, "measured close")
box(s, 0.75, 1.8, 7.7, 4.35, "", fill=NAVY)
box(s, 1.15, 2.15, 6.9, 0.42, "THE THESIS", 12, RGBColor(0x9E, 0xE5, 0xD4), True, MONO)
box(s, 1.15, 2.95, 6.9, 1.55, "Price the counterparty.\nProtect the deadline.", 31, CARD, True, TITLE, PP_ALIGN.CENTER, NAVY, NAVY, 0.05, 0.16, MSO_ANCHOR.MIDDLE)
box(s, 1.15, 4.95, 6.9, 0.55, "Instant mode: 20 confirmed requests, 4,995 ms p50, 6,462 ms p95.", 14, RGBColor(0xD8, 0xED, 0xE7), True, MONO, PP_ALIGN.CENTER)
box(s, 8.85, 1.8, 3.7, 4.35, "", fill=CARD, line=LINE)
box(s, 9.2, 2.15, 3.0, 0.42, "CARDANO", 12, TEAL, True, MONO)
box(s, 9.2, 2.8, 2.95, 1.45, "One spend.\nOne winner.", 29, INK, True, TITLE)
box(s, 9.2, 4.55, 2.9, 0.95, "Let the chain enforce the route.", 17, TEAL_DARK, True)
box(s, 0.75, 6.55, 11.8, 0.45, "Cost of Trust  |  agents buy reliability, and Cardano enforces one winner.", 18, TEAL_DARK, True, BODY, PP_ALIGN.CENTER)

prs.save(OUT)
print(f"wrote {OUT}")
