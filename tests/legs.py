import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8770), functools.partial(http.server.SimpleHTTPRequestHandler, directory="."))
threading.Thread(target=srv.serve_forever, daemon=True).start()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8770/tests/index.html"); await pg.wait_for_function("window.__ready === true")
        for extra in ({}, {"leg_max": 6000}, {"leg_max": 6000, "legs": [{"entity": "sensor.solark_inverter_l1_power", "name": "L1", "max": 650}, {"entity": "sensor.solark_inverter_l2_power", "name": "L2"}]}):
            r = await pg.evaluate("""(extra) => { const c = window.__cards[1]; c.setConfig({ ...c._config, ...extra });
              return [...c.shadowRoot.querySelectorAll('.leg')].map(l => l.querySelector('.val').textContent + ' bar=' + l.querySelector('.bar i').style.width); }""", extra)
            print(extra.get("leg_max"), r)
        print("errors:", errs); await b.close()
asyncio.run(main())
