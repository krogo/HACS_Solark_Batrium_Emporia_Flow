"""Stub configs from recorded states, empty-config hint, and editor <-> config round trips (ha-form mocked)."""
import asyncio, json, http.server, threading, functools
from playwright.async_api import async_playwright
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8768), functools.partial(http.server.SimpleHTTPRequestHandler, directory="."))
threading.Thread(target=srv.serve_forever, daemon=True).start()

JS = r"""async () => {
  // Stand-in for HA's ha-form: keeps schema/data, lets the test emit value-changed.
  if (!customElements.get("ha-form")) customElements.define("ha-form", class extends HTMLElement {
    emit(data) { this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: data }, bubbles: true, composed: true })); }
  });
  const hass = window.__cards[0].hass;
  const out = {};
  const tags = ["energy-flow-card", "inverter-card", "battery-bank-card", "circuits-card"];
  out.stubs = {};
  for (const t of tags) out.stubs[t] = customElements.get(t).getStubConfig(hass);

  // Empty config renders a hint instead of throwing.
  out.empty = {};
  for (const t of tags) {
    const el = document.createElement(t); el.setConfig({ type: "custom:" + t }); el.hass = hass;
    out.empty[t] = el.shadowRoot.textContent.includes("No sensors set yet");
  }

  const edit = async (tag, cfg, change) => {
    const ed = customElements.get(tag).getConfigElement();
    document.body.appendChild(ed);
    let got = null; ed.addEventListener("config-changed", (e) => (got = e.detail.config));
    ed.setConfig(cfg); ed.hass = hass;
    const form = ed.querySelector("ha-form");
    const before = JSON.parse(JSON.stringify(form.data));
    form.emit({ ...form.data, ...change });
    ed.remove();
    return { before, after: got, schemaTop: form.schema.map((s) => s.name || "[" + s.title + "]") };
  };
  const flowCfg = (await (await fetch("cards.json")).json())[0];
  out.flow1 = await edit("energy-flow-card", flowCfg, { battery_invert: false, grid: "", idle_threshold: 50 });
  out.flow2 = await edit("energy-flow-card", { type: "custom:energy-flow-card", solar: "sensor.a" }, { solar_invert: true });
  out.inv1 = await edit("inverter-card", out.stubs["inverter-card"], { pv3: "sensor.solark_pv3_input_power" });
  out.inv2 = await edit("inverter-card", out.stubs["inverter-card"], { pv2: "", t2_name: "House" });
  out.bat1 = await edit("battery-bank-card", out.stubs["battery-bank-card"], { cell_hi: 3.65, power_invert: true });
  const circ = { type: "custom:circuits-card", entities: [{ entity: "sensor.emporiavue2_range_power", name: "Stove" }, "sensor.emporiavue2_dryer_power"] };
  out.circ1 = await edit("circuits-card", circ, { entities: ["sensor.emporiavue2_range_power", "sensor.emporiavue2_heat_pump_power"] });

  // Stub configs render real values.
  out.render = {};
  for (const t of tags) {
    const el = document.createElement(t); el.setConfig({ type: "custom:" + t, ...out.stubs[t] }); el.hass = hass;
    document.getElementById("g").appendChild(el);
    out.render[t] = el.shadowRoot.textContent.replace(/\s+/g, " ").slice(0, 160);
  }
  return out;
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 900, "height": 1400})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8768/tests/index.html?theme=dark")
        await pg.wait_for_function("window.__ready === true")
        out = await pg.evaluate(JS)
        print(json.dumps(out, indent=1))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
