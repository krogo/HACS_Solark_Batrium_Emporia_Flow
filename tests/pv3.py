import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8767), functools.partial(http.server.SimpleHTTPRequestHandler, directory="."))
threading.Thread(target=srv.serve_forever, daemon=True).start()
JS = """async (mode) => {
  const card = window.__cards[1];                       // inverter card
  const s = JSON.parse(JSON.stringify(card.hass.states));
  const cfg = JSON.parse(JSON.stringify(card._config));
  if (mode === 'present') s['sensor.solark_pv3_input_power'] = { entity_id: 'sensor.solark_pv3_input_power', state: '3120', attributes: { unit_of_measurement: 'W' } };
  if (mode === 'show_missing') cfg.pv.show_missing = true;
  card.setConfig(cfg); card.hass = { states: s, entities: {} };
  return [...card.shadowRoot.querySelectorAll('.str')].map(r => r.querySelector('.lbl').textContent + '=' + r.querySelector('.w').textContent);
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 900, "height": 900}, device_scale_factor=1.5)
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        for mode in ("missing", "present", "show_missing"):
            await pg.goto("http://127.0.0.1:8767/tests/index.html?theme=dark")
            await pg.wait_for_function("window.__ready === true")
            print(mode, await pg.evaluate(JS, mode))
            if mode == "present":
                await pg.locator("inverter-card").screenshot(path="tests/pv3.png")
        print("errors:", errs)
        await b.close()
asyncio.run(main())
