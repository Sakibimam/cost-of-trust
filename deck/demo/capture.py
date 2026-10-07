#!/usr/bin/env python3
import base64, json, math, pathlib, re, subprocess, sys, time, urllib.request, websocket

ROOT = pathlib.Path(__file__).parent
beats = json.loads((ROOT / "beats.json").read_text())

def duration(wav):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(wav)], text=True))

def run_scene(scene, seconds, out):
    js = """(() => {
      const needle = %s;
      const all = [...document.querySelectorAll('h1,h2,h3,p,div,span')];
      const el = all.find(e => (e.innerText || '').trim() === needle) || all.find(e => (e.innerText || '').includes(needle));
      if (el) { el.scrollIntoView({behavior:'smooth', block:'center'}); el.style.outline='3px solid #e64b35'; el.style.outlineOffset='6px'; }
      return !!el;
    })()""" % json.dumps(scene.get("target", ""))
    payload = base64.b64encode(js.encode()).decode()
    code = f"import base64; cdp('Emulation.setDeviceMetricsOverride', width=1440, height=900, deviceScaleFactor=1, mobile=False); goto_url({scene['url']!r}); wait_for_load(); wait(1); js(base64.b64decode({payload!r}).decode()); wait(1); print('ready')"
    subprocess.run(["bh-multi", "run", "qa", code], capture_output=True, text=True, check=True)
    targets = json.load(urllib.request.urlopen("http://127.0.0.1:9318/json/list"))
    ws = websocket.create_connection(next(t["webSocketDebuggerUrl"] for t in targets if t.get("type") == "page"), suppress_origin=True)
    seq = 0
    def cmd(method, params=None):
        nonlocal seq
        seq += 1
        ws.send(json.dumps({"id": seq, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == seq: return msg["result"]
    frames = [base64.b64decode(cmd("Page.captureScreenshot", {"format":"jpeg", "quality":85})["data"]) for _ in range(max(1, math.ceil(seconds)))]
    ws.close()
    for i in range(math.ceil(seconds * 8)):
        (out / f"{i:05d}.jpg").write_bytes(frames[min(i // 8, len(frames) - 1)])

for beat in beats:
    wav = ROOT / f"beat-{beat['id']}.wav"
    if not wav.exists():
        raise SystemExit(f"missing {wav}")
    total = duration(wav)
    beat_dir = ROOT / f"frames-{beat['id']}"
    beat_dir.mkdir(exist_ok=True)
    for old in beat_dir.glob("scene-*/*.jpg"):
        old.unlink()
    cursor = 0
    for scene in beat["scenes"]:
        seconds = total * scene["share"]
        out = beat_dir / f"scene-{cursor:03d}"
        out.mkdir(exist_ok=True)
        run_scene(scene, seconds, out)
        cursor += 1
    print(f"beat {beat['id']}: {total:.3f}s")

subprocess.run(["bh-multi", "run", "qa", "cdp('Emulation.clearDeviceMetricsOverride')"], check=True)
