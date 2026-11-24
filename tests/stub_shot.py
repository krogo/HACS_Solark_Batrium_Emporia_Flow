"""Render each card from its auto-detected starting config (what the card picker creates)."""
import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8769), functools.partial(http.server.SimpleHTTPRequestHandler, directory="."))
threading.Thread(target=srv.serve_forever, daemon=True).start()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 900, "height": 1400}, device_scale_factor=1.25)
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8769/tests/index.html?theme=dark")
        await pg.wait_for_function("window.__ready === true")
        await pg.evaluate("""() => {
          const g = document.getElementById('g'); const hass = window.__cards[0].hass; g.innerHTML = '';
          for (const t of ['energy-flow-card','inverter-card','battery-bank-card','circuits-card']) {
            const el = document.createElement(t); el.setConfig({ type: 'custom:' + t, ...customElements.get(t).getStubConfig(hass) });
            el.hass = hass; g.appendChild(el);
          }}""")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path="tests/stub.png", full_page=True)
        print("errors:", errs)
        await b.close()
asyncio.run(main())
