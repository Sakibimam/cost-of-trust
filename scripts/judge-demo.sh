#!/usr/bin/env bash
# Price four buyer presets on the deployed router, then confirm preprod transactions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="https://cost-of-trust.vercel.app"
KOIOS="https://preprod.koios.rest/api/v1/tx_status"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

printf 'GET %s/api/router/health\n' "$BASE"
curl -fsS --max-time 30 "$BASE/api/router/health"
printf '\n\n'

printf 'POST %s/api/router/best-route\n' "$BASE"
n=0
for risk in 0 0.5; do
  for shared in false true; do
    n=$((n + 1))
    python3 -c 'import json, sys
risk = float(sys.argv[1])
shared = sys.argv[2] == "true"
json.dump({
  "task": "claim before expiry",
  "serviceType": "cardano_deadline_execution",
  "deadline": "2030-01-01T00:00:00Z",
  "downstreamLossAda": 100,
  "candidateSellers": ["seller-a", "seller-b", "seller-c"],
  "riskAversion": risk,
  "sharedInfrastructure": shared,
  "constraints": {"allowRedundancy": True},
}, open(sys.argv[3], "w"))' "$risk" "$shared" "$workdir/body-$n.json"
    printf '%s %s\n' "$risk" "$shared" > "$workdir/label-$n.txt"
    curl -fsS --max-time 45 -X POST "$BASE/api/router/best-route" \
      -H "content-type: application/json" \
      --data-binary @"$workdir/body-$n.json" \
      > "$workdir/route-$n.json"
  done
done

python3 - "$workdir" <<'PY'
import json
import pathlib
import sys

workdir = pathlib.Path(sys.argv[1])
rows = []
for n in range(1, 5):
    risk, shared = (workdir / f"label-{n}.txt").read_text().split()
    payload = json.loads((workdir / f"route-{n}.json").read_text())
    routes = payload.get("routes") or []
    if "selectedRoute" not in payload or not routes:
        sys.exit("best-route response is missing selectedRoute or routes")
    minimum = min(route["riskAdjustedCostAda"] for route in routes)
    sellers = ",".join(payload["selectedSellers"])
    rows.append((risk, shared, payload["selectedRoute"], sellers, f"{minimum:.2f}"))

headers = ("riskAversion", "sharedInfrastructure", "selectedRoute", "sellers", "minRiskAdjustedCostAda")
print("| " + " | ".join(headers) + " |")
print("| " + " | ".join("---" for _ in headers) + " |")
for row in rows:
    print("| " + " | ".join(row) + " |")
print()
PY

shopt -s nullglob
files=( "$ROOT"/agents/runs/2026-10-06T04-*.json )
if [ "${#files[@]}" -eq 0 ]; then
  echo "no agents/runs/2026-10-06T04-*.json files" >&2
  exit 1
fi

python3 - "${files[@]}" > "$workdir/hashes.txt" <<'PY'
import json
import sys

fixed = [
    "a6e3fbda65dd8a05b7252e1205f55ba34986b68df75f89e5430ab80818370e85",
    "8c9db32499ec2bdb8c275627f5530eb6d89a5c0ab7642d909c82d3d9ff51afad",
    "9c560b70982fb56766919f21087e811a52133fe665e66ccfe1a5da012f4286a0",
]
seen = []

def add(tx_hash):
    if tx_hash not in seen:
        seen.append(tx_hash)

for tx_hash in fixed:
    add(tx_hash)

def walk(node):
    if isinstance(node, dict):
        tx_hash = node.get("txHash")
        if node.get("confirmed") is True and isinstance(tx_hash, str):
            add(tx_hash)
        for value in node.values():
            walk(value)
    elif isinstance(node, list):
        for value in node:
            walk(value)

for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as handle:
        walk(json.load(handle))

if len(seen) < 4:
    sys.exit("expected the fixed transactions plus confirmed run hashes")
for tx_hash in seen:
    print(tx_hash)
PY

python3 -c 'import json, sys
hashes = [line.strip() for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
json.dump({"_tx_hashes": hashes}, open(sys.argv[2], "w"))' "$workdir/hashes.txt" "$workdir/koios-body.json"

printf 'POST %s\n' "$KOIOS"
attempt=0
while true; do
  attempt=$((attempt + 1))
  code="$(curl -sS --max-time 60 -o "$workdir/koios.json" -w "%{http_code}" \
    -X POST "$KOIOS" \
    -H "content-type: application/json" \
    -H "accept: application/json" \
    --data-binary @"$workdir/koios-body.json" || true)"
  if [ "$code" = "200" ]; then
    break
  fi
  if [ "$code" = "429" ] && [ "$attempt" -lt 8 ]; then
    sleep $((attempt * 2))
    continue
  fi
  echo "Koios tx_status HTTP ${code:-network}" >&2
  exit 1
done

python3 - "$workdir/hashes.txt" "$workdir/koios.json" <<'PY'
import json
import sys

hashes = [line.strip() for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
payload = json.load(open(sys.argv[2], encoding="utf-8"))
if not isinstance(payload, list):
    sys.exit("Koios tx_status did not return a list")

by_hash = {}
for row in payload:
    if isinstance(row, dict) and isinstance(row.get("tx_hash"), str):
        by_hash[row["tx_hash"]] = row.get("num_confirmations")

failed = False
for tx_hash in hashes:
    confirmations = by_hash.get(tx_hash)
    if isinstance(confirmations, (int, float)) and not isinstance(confirmations, bool) and confirmations >= 1:
        print(f"{tx_hash} confirmations={int(confirmations)}")
    else:
        shown = 0 if confirmations is None else confirmations
        print(f"{tx_hash} confirmations={shown} UNCONFIRMED")
        failed = True

if failed:
    sys.exit(1)
print(f"confirmed {len(hashes)} of {len(hashes)}")
PY
