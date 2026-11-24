import asyncio, json, sys, http.server, threading, functools
from playwright.async_api import async_playwright
root = "."
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 900, "height": 1400}, device_scale_factor=1.5)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        for theme in ("dark", "light"):
            await pg.goto(f"http://127.0.0.1:8765/tests/index.html?theme={theme}")
            await pg.wait_for_function("window.__ready === true", timeout=10000)
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=f"{root}/tests/{theme}.png", full_page=True)
        # click a tile -> more-info event
        await pg.evaluate("window.__cards[2].shadowRoot.querySelector('.tile').click()")
        print("more-info:", await pg.evaluate("window.__events"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
