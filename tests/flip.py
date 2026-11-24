# Flip to discharging + grid import and confirm the flow card patches in place without errors.
import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8766), functools.partial(http.server.SimpleHTTPRequestHandler, directory="."))
threading.Thread(target=srv.serve_forever, daemon=True).start()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 900, "height": 700}, device_scale_factor=1.5)
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8766/tests/index.html?theme=dark")
        await pg.wait_for_function("window.__ready === true")
        node_before = await pg.evaluate("window.__cards[0].shadowRoot.getElementById('n-battery') !== null")
        await pg.evaluate("""() => {
          const s = JSON.parse(JSON.stringify(window.__cards[0].hass.states));
          s['sensor.solark_pv_input_power'].state = '0';
          s['sensor.solark_battery_power'].state = '3200';      // + = discharging on SolArk
          s['sensor.solark_total_grid_power'].state = '1800';    // importing
          s['sensor.solark_load_power'].state = '5000';
          s['sensor.batrium_pack_power'].state = '-1.4';
          for (const c of window.__cards) c.hass = { states: s, entities: {} };
        }""")
        await pg.wait_for_timeout(500)
        same_node = await pg.evaluate("window.__cards[0].shadowRoot.getElementById('n-battery') !== null")
        info = await pg.evaluate("""() => { const r = window.__cards[0].shadowRoot;
          return { batt: r.getElementById('s-battery').textContent, grid: r.getElementById('s-grid').textContent,
                   chip: r.getElementById('chip').textContent, dir: r.getElementById('d-battery').style.getPropertyValue('--dir'),
                   solarOn: r.getElementById('d-solar').classList.contains('on'),
                   bank: window.__cards[2].shadowRoot.querySelector('.chip').textContent }; }""")
        await pg.locator("energy-flow-card").screenshot(path="tests/flow-night.png")
        print(node_before, same_node, info, "errors:", errs)
        await b.close()
asyncio.run(main())
