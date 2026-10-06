# Live check: BU_NAME=deepsurge browser-harness < web/scripts/verify-live.py
# Loads the production page at 375 and 1440, reports console errors and rendered text.
import json, time
URL = "https://cost-of-trust.vercel.app"
new_tab(URL)
wait_for_load()
out = {}
for w, h in [(375, 812), (1440, 900)]:
    cdp("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=(w < 500))
    drain_events()
    goto_url(URL); wait_for_load(); time.sleep(5)
    errs = []
    for e in drain_events():
        m = e.get("method"); p = e.get("params", {})
        if m == "Runtime.exceptionThrown": errs.append(e)
        elif m == "Log.entryAdded" and p.get("entry", {}).get("level") == "error": errs.append(e)
        elif m == "Runtime.consoleAPICalled" and p.get("type") == "error": errs.append(e)
    txt = js("document.body.innerText")
    out[w] = {"len": len(txt), "errs": len(errs), "errsample": [json.dumps(e)[:250] for e in errs[:3]],
              "runs": js("document.querySelectorAll('[data-testid=run]').length"),
              "scrollW": js("document.documentElement.scrollWidth"), "innerW": js("innerWidth"),
              "text": txt[:1200]}
cdp("Emulation.clearDeviceMetricsOverride")
print(json.dumps(out, indent=1))
