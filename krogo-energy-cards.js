/*
 * krogo energy cards — a matching set of Lovelace cards for a SolArk inverter,
 * battery banks (Batrium, Saft, …) and Emporia Vue circuit monitoring.
 *
 *   custom:energy-flow-card     live solar / grid / home / battery power flow
 *   custom:battery-bank-card    one bank: SOC ring, power, time to full/empty,
 *                               cell voltage spread, per-cell bars, temps, limits
 *   custom:circuits-card        circuits sorted by power (explicit list or auto)
 *   custom:inverter-card        PV strings, inverter legs, grid, today's totals
 *
 * Every entity is set in YAML. Units are normalised from unit_of_measurement
 * (W/kW, mV/V, Wh/kWh/MWh), so mixing sources is fine. Sign conventions are
 * per entity: append `invert: true` where a source reports the other way round.
 *
 * Install: copy to /config/www/, add /local/krogo-energy-cards.js?v=1 as a
 * JavaScript module resource, hard-refresh the browser.
 */

const VERSION = "1.2.1";

/* ------------------------------------------------------------------ helpers */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Entity spec may be "sensor.x" or { entity, invert, name, icon }. */
const spec = (s) => (s == null ? null : typeof s === "string" ? { entity: s } : s);

function stateObj(hass, s) {
  s = spec(s);
  return s && hass ? hass.states[s.entity] : undefined;
}

/** Numeric value, or null if missing/unavailable. Applies `invert`. */
function num(hass, s) {
  const st = stateObj(hass, s);
  if (!st) return null;
  const v = parseFloat(st.state);
  if (!isFinite(v)) return null;
  return spec(s).invert ? -v : v;
}

const unitOf = (hass, s) => (stateObj(hass, s)?.attributes?.unit_of_measurement || "").trim();

/** Power in W regardless of source unit. */
function watts(hass, s) {
  const v = num(hass, s);
  if (v == null) return null;
  const u = unitOf(hass, s).toLowerCase();
  return u === "kw" ? v * 1000 : u === "mw" ? v * 1e6 : v;
}

/** Voltage in V regardless of source unit. */
function volts(hass, s) {
  const v = num(hass, s);
  if (v == null) return null;
  return unitOf(hass, s).toLowerCase() === "mv" ? v / 1000 : v;
}

/** Temperature as { v, unit } in whatever unit HA reports (°C or °F). */
function temp(hass, s) {
  const v = num(hass, s);
  return { v, unit: unitOf(hass, s) || "°C" };
}

/** Energy in kWh regardless of source unit. */
function kwh(hass, s) {
  const v = num(hass, s);
  if (v == null) return null;
  const u = unitOf(hass, s).toLowerCase();
  return u === "wh" ? v / 1000 : u === "mwh" ? v * 1000 : v;
}

function fmtPower(w, { signed = false } = {}) {
  if (w == null) return "—";
  const a = Math.abs(w);
  const sign = signed && w < 0 ? "−" : "";
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(a >= 10000 ? 1 : 2)} kW`;
  return `${sign}${Math.round(a)} W`;
}

const fmt = (v, d = 1, unit = "") => (v == null ? "—" : `${v.toFixed(d)}${unit ? " " + unit : ""}`);

function fmtMinutes(m) {
  if (m == null || m < 0) return null;
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Opens HA's more-info dialog for an entity. */
function moreInfo(el, entityId) {
  if (!entityId) return;
  el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
}

/** SVG ring (stroke-dasharray arc). pct 0..100. */
function ring(pct, { size = 112, stroke = 10, color = "var(--kec-accent)", track = "var(--kec-track)" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = pct == null ? 0 : clamp(pct, 0, 100);
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

/* ------------------------------------------------------------- shared style */

const STYLE = `
  :host {
    --kec-accent: var(--accent-color, var(--primary-color));
    --kec-solar: var(--energy-solar-color, #ff9800);
    --kec-grid-in: var(--energy-grid-consumption-color, #488fc2);
    --kec-grid-out: var(--energy-grid-return-color, #8353d1);
    --kec-batt-in: var(--energy-battery-in-color, #f06292);
    --kec-batt-out: var(--energy-battery-out-color, #4db6ac);
    --kec-home: var(--primary-color, #03a9f4);
    --kec-ok: var(--success-color, #43a047);
    --kec-warn: var(--warning-color, #ffa600);
    --kec-bad: var(--error-color, #db4437);
    --kec-track: var(--divider-color, rgba(127,127,127,.25));
    --kec-muted: var(--secondary-text-color);
    --kec-tile: rgba(127,127,127,.08);
    display: block;
  }
  ha-card { padding: 14px 16px 16px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .head .title { font-size: 1.05rem; font-weight: 500; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head ha-icon { color: var(--kec-muted); --mdc-icon-size: 20px; }
  .chip { font-size: .75rem; font-weight: 500; padding: 3px 9px; border-radius: 999px; white-space: nowrap;
          background: color-mix(in srgb, var(--chip, var(--kec-muted)) 18%, transparent); color: var(--chip, var(--kec-muted)); }
  .lbl { font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; color: var(--kec-muted); }
  .val { font-size: 1.05rem; font-weight: 500; font-variant-numeric: tabular-nums; }
  .val small { font-size: .75rem; font-weight: 400; color: var(--kec-muted); margin-left: 2px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
  .tile { background: var(--kec-tile); border-radius: 12px; padding: 8px 10px; cursor: pointer; min-width: 0; }
  .tile:hover { background: color-mix(in srgb, var(--kec-tile) 100%, var(--primary-text-color) 6%); }
  .tile .lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .section { margin-top: 14px; }
  .section > .lbl { display: block; margin-bottom: 6px; }
  .bar { height: 6px; border-radius: 3px; background: var(--kec-track); overflow: hidden; position: relative; }
  .bar > i { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 3px; background: var(--c, var(--kec-accent)); }
  .click { cursor: pointer; }
  .muted { color: var(--kec-muted); }
  .warn { color: var(--kec-warn); } .bad { color: var(--kec-bad); }
`;

/* ---------------------------------------------------------------- base card */

class KecBase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = null;
  }
  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this.validate(config);
    this._config = config;
    this._sig = null;
    if (this._hass) this._render(true);
  }
  validate() {}
  set hass(hass) {
    this._hass = hass;
    this._render(false);
  }
  get hass() { return this._hass; }
  /** Entity ids this card reads; used to skip renders when nothing changed. */
  watched() { return []; }
  _render(force) {
    if (!this._config || !this._hass) return;
    const sig = this.watched().map((e) => {
      const s = this._hass.states[e];
      return s ? s.state + "|" + (s.attributes.unit_of_measurement || "") : "~";
    }).join(",");
    if (!force && sig === this._sig) return;
    this._sig = sig;
    this.update();
  }
  /** Full re-render. Subclasses with animations override to patch in place. */
  update() {
    this.shadowRoot.innerHTML = `<style>${STYLE}${this.css ? this.css() : ""}</style>${this.html()}`;
    this.shadowRoot.querySelectorAll("[data-entity]").forEach((el) =>
      el.addEventListener("click", (ev) => { ev.stopPropagation(); moreInfo(this, el.dataset.entity); }));
    if (this.bind) this.bind();
  }
  getCardSize() { return 4; }
}

const eid = (s) => spec(s)?.entity || "";
const ids = (...specs) => specs.flat().map(eid).filter(Boolean);

/* ---------------------------------------------------------- energy-flow-card */
/*
 * type: custom:energy-flow-card
 * title: Power flow
 * solar:   { entity: sensor.solark_pv_power }          # W/kW, >= 0
 * home:    { entity: sensor.solark_load_power }        # W/kW, >= 0
 * battery: { entity: sensor.solark_battery_power, invert: true,   # + = charging after invert
 *            soc: sensor.batrium_soc }
 * grid:    { entity: sensor.solark_grid_power,  # + = importing
 *            relay: sensor.solark_grid_relay }  # optional; "Open"/off shows as off-grid
 * idle_threshold: 20                             # W below which a path is idle
 */
class EnergyFlowCard extends KecBase {
  validate(c) {
    if (!c.solar && !c.home && !c.battery && !c.grid) throw new Error("Set at least one of solar, home, battery, grid");
  }
  watched() {
    const c = this._config;
    return ids(c.solar, c.home, c.battery, c.grid, c.battery?.soc, c.grid?.relay);
  }
  getCardSize() { return 5; }
  css() {
    return `
      .flow { position: relative; width: 100%; aspect-ratio: 400 / 290; container-type: inline-size; }
      .flow svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .path { fill: none; stroke: var(--kec-track); stroke-width: 2; }
      .dots { fill: none; stroke-width: 4; stroke-linecap: round; stroke-dasharray: 0 14; opacity: 0;
              animation: kec-run var(--dur, 2s) linear infinite; animation-direction: var(--dir, normal); }
      .dots.on { opacity: 1; }
      @keyframes kec-run { to { stroke-dashoffset: -28; } }
      @media (prefers-reduced-motion: reduce) { .dots { animation: none; stroke-dasharray: none; stroke-width: 2.5; } }
      .node { position: absolute; transform: translate(-50%, -50%); width: 25%; aspect-ratio: 1; border-radius: 50%;
              display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
              border: 2px solid var(--nc); background: var(--ha-card-background, var(--card-background-color));
              cursor: pointer; box-sizing: border-box; }
      .node ha-icon { color: var(--nc); --mdc-icon-size: 22px; }
      .node .v { font-weight: 600; font-variant-numeric: tabular-nums; font-size: clamp(.8rem, 3.4cqw, 1rem); }
      .node .s { font-size: clamp(.62rem, 2.6cqw, .75rem); color: var(--kec-muted); }
      .node.dim { opacity: .55; }
      .node.batt { border: none; }
      .node.batt .ringwrap { position: absolute; inset: -2px; }
      .node.batt .ringwrap svg { width: 100%; height: 100%; }
      .hub { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 9%; aspect-ratio: 1;
             border-radius: 50%; background: var(--kec-tile); border: 2px solid var(--kec-track);
             display: flex; align-items: center; justify-content: center; }
      .hub ha-icon { --mdc-icon-size: 18px; color: var(--kec-muted); }
    `;
  }
  html() {
    const c = this._config;
    // Node centres in the 400x290 viewBox; hub at 200,145.
    const N = { solar: [200, 40], grid: [52, 145], home: [348, 145], battery: [200, 250] };
    const P = {
      solar: `M200 76 L200 132`, grid: `M88 145 L187 145`,
      home: `M213 145 L312 145`, battery: `M200 158 L200 214`,
    };
    const paths = Object.keys(N).filter((k) => c[k]).map((k) =>
      `<path class="path" d="${P[k]}"/><path class="dots" id="d-${k}" d="${P[k]}"/>`).join("");
    const pos = (k) => `left:${(N[k][0] / 400) * 100}%;top:${(N[k][1] / 290) * 100}%`;
    const node = (k, icon, colorVar, extra = "") => c[k] ? `
      <div class="node ${k === "battery" ? "batt" : ""}" id="n-${k}" style="${pos(k)};--nc:${colorVar}" data-entity="${esc(eid(c[k]))}">
        ${extra}<ha-icon icon="${icon}"></ha-icon><div class="v" id="v-${k}">—</div><div class="s" id="s-${k}"></div>
      </div>` : "";
    return `<ha-card>
      <div class="head"><ha-icon icon="mdi:transmission-tower-export"></ha-icon>
        <div class="title">${esc(c.title ?? "Power flow")}</div><span class="chip" id="chip"></span></div>
      <div class="flow">
        <svg viewBox="0 0 400 290" preserveAspectRatio="xMidYMid meet">${paths}</svg>
        <div class="hub"><ha-icon icon="mdi:sine-wave"></ha-icon></div>
        ${node("solar", "mdi:solar-power-variant", "var(--kec-solar)")}
        ${node("grid", "mdi:transmission-tower", "var(--kec-grid-in)")}
        ${node("home", "mdi:home-lightning-bolt", "var(--kec-home)")}
        ${node("battery", "mdi:battery-charging", "var(--kec-batt-in)", `<div class="ringwrap" id="r-battery"></div>`)}
      </div>
    </ha-card>`;
  }
  update() {
    // Build once; afterwards patch values so the CSS animations keep running.
    if (!this.shadowRoot.getElementById("chip")) super.update();
    const c = this._config, h = this._hass, $ = (id) => this.shadowRoot.getElementById(id);
    const idle = c.idle_threshold ?? 20;
    const solar = c.solar ? Math.max(0, watts(h, c.solar) ?? 0) : null;
    const home = c.home ? Math.abs(watts(h, c.home) ?? 0) : null;
    const batt = c.battery ? watts(h, c.battery) : null;   // + charging
    const grid = c.grid ? watts(h, c.grid) : null;         // + importing

    // Solar and grid paths are drawn node→hub; home and battery hub→node.
    const anim = (k, w, towardHub) => {
      const d = $(`d-${k}`); if (!d) return;
      const on = w != null && Math.abs(w) >= idle;
      d.classList.toggle("on", on);
      if (!on) return;
      // 0.6 s at ≥8 kW, ~3 s near idle (log scale), so speed reads as magnitude.
      const dur = clamp(3.2 - Math.log10(Math.abs(w) / idle) * 1.05, 0.6, 3.2);
      d.style.setProperty("--dur", `${dur.toFixed(2)}s`);
      const drawnTowardHub = k === "solar" || k === "grid";
      d.style.setProperty("--dir", towardHub === drawnTowardHub ? "normal" : "reverse");
    };

    if (c.solar) {
      $("v-solar").textContent = fmtPower(solar);
      $("s-solar").textContent = "Solar";
      $("d-solar").style.stroke = "var(--kec-solar)";
      anim("solar", solar, true);
      $("n-solar").classList.toggle("dim", solar < idle);
    }
    if (c.home) {
      $("v-home").textContent = fmtPower(home);
      $("s-home").textContent = "Home";
      $("d-home").style.stroke = "var(--kec-home)";
      anim("home", home, false);
    }
    if (c.grid) {
      const relay = c.grid.relay ? stateObj(h, c.grid.relay)?.state : null;
      const off = relay != null && /^(open|off|disconnected|0|false)$/i.test(relay);
      $("v-grid").textContent = off ? "Off-grid" : fmtPower(grid == null ? null : Math.abs(grid));
      $("s-grid").textContent = off ? (relay ?? "") : grid == null ? "Grid" : grid >= idle ? "Importing" : grid <= -idle ? "Exporting" : "Grid";
      const col = grid != null && grid < 0 ? "var(--kec-grid-out)" : "var(--kec-grid-in)";
      $("n-grid").style.setProperty("--nc", col);
      $("d-grid").style.stroke = col;
      anim("grid", off ? null : grid, grid != null && grid > 0);
      $("n-grid").classList.toggle("dim", off || grid == null || Math.abs(grid) < idle);
    }
    if (c.battery) {
      const soc = c.battery.soc ? num(h, c.battery.soc) : null;
      const charging = batt != null && batt >= idle, discharging = batt != null && batt <= -idle;
      const col = discharging ? "var(--kec-batt-out)" : "var(--kec-batt-in)";
      $("n-battery").style.setProperty("--nc", col);
      $("r-battery").innerHTML = ring(soc, { size: 100, stroke: 6, color: col });
      $("v-battery").textContent = fmtPower(batt == null ? null : Math.abs(batt));
      $("s-battery").textContent = (soc != null ? `${soc.toFixed(0)}% · ` : "") + (charging ? "Charging" : discharging ? "Discharging" : "Idle");
      $("n-battery").querySelector("ha-icon").setAttribute("icon",
        charging ? "mdi:battery-charging" : discharging ? "mdi:battery-arrow-down" : "mdi:battery");
      $("d-battery").style.stroke = col;
      anim("battery", batt, discharging);
    }

    // Header chip: where the home's power is mostly coming from right now.
    const chip = $("chip");
    const sources = [["Solar", solar ?? 0, "var(--kec-solar)"], ["Battery", batt != null && batt < 0 ? -batt : 0, "var(--kec-batt-out)"],
                     ["Grid", grid != null && grid > 0 ? grid : 0, "var(--kec-grid-in)"]].sort((a, b) => b[1] - a[1]);
    if (sources[0][1] >= idle) {
      chip.textContent = `${sources[0][0]} powered`;
      chip.style.setProperty("--chip", sources[0][2]);
      chip.hidden = false;
    } else chip.hidden = true;
  }
}

/* --------------------------------------------------------- battery-bank-card */
/*
 * type: custom:battery-bank-card
 * name: Batrium pack
 * icon: mdi:car-battery
 * entities:            # all optional except soc or power
 *   soc: sensor.batrium_soc
 *   power: sensor.batrium_shunt_power          # + = charging (invert: true if not)
 *   current: sensor.batrium_shunt_current
 *   voltage: sensor.batrium_pack_voltage
 *   time_to_full: sensor.batrium_estimated_time_to_full      # minutes; -1 hidden
 *   time_to_empty: sensor.batrium_estimated_time_to_empty
 *   capacity_to_full: sensor.batrium_capacity_to_full        # Ah
 *   capacity_to_empty: sensor.batrium_capacity_to_empty
 *   cell_min: sensor.batrium_cell_voltage_min
 *   cell_max: sensor.batrium_cell_voltage_max
 *   temp_min: sensor.batrium_cell_temp_min
 *   temp_max: sensor.batrium_cell_temp_max
 *   charge_limit: sensor.batrium_charger_target_current
 *   discharge_limit: sensor.batrium_inverter_target_current
 *   energy_in: sensor.batrium_today_energy_in
 *   energy_out: sensor.batrium_today_energy_out
 * cells:               # optional per-cell bars: a list, or a pattern + count
 *   pattern: sensor.batrium_cell_{n}_voltage
 *   count: 14
 * cell_range: [3.0, 4.2]      # V; bar scale and colouring
 * spread_warn: 0.05           # V; cell spread shown in warning colour above this
 * idle_threshold: 20          # W
 */
class BatteryBankCard extends KecBase {
  validate(c) {
    if (!c.entities || (!c.entities.soc && !c.entities.power)) throw new Error("entities.soc or entities.power is required");
  }
  _cells() {
    const cc = this._config.cells;
    if (!cc) return [];
    if (Array.isArray(cc)) return cc.map(spec);
    if (cc.entities) return cc.entities.map(spec);
    if (cc.pattern && cc.count) return Array.from({ length: cc.count }, (_, i) => ({ entity: cc.pattern.replace("{n}", i + 1) }));
    return [];
  }
  watched() { return ids(Object.values(this._config.entities), this._cells()); }
  getCardSize() { return this._config.cells ? 7 : 5; }
  css() {
    return `
      .top { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center; }
      .socwrap { position: relative; width: 112px; height: 112px; cursor: pointer; }
      .socwrap .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .socwrap .pct { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; }
      .socwrap .pct small { font-size: .9rem; font-weight: 400; color: var(--kec-muted); }
      .socwrap .sub { font-size: .75rem; color: var(--kec-muted); }
      .kv { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .spread { display: flex; align-items: center; gap: 10px; }
      .spread .rng { flex: 1; position: relative; height: 22px; }
      .spread .rng .bar { position: absolute; left: 0; right: 0; top: 8px; }
      .spread .rng .band { position: absolute; top: 4px; height: 14px; border-radius: 7px; background: var(--c); opacity: .85; min-width: 4px; }
      .cells { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 3px; align-items: end; height: 64px; }
      .cell { position: relative; height: 100%; border-radius: 3px 3px 2px 2px; background: var(--kec-track); cursor: pointer; }
      .cell > i { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 3px 3px 2px 2px; background: var(--c); }
      .cellnums { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 3px; margin-top: 3px;
                  font-size: .62rem; text-align: center; color: var(--kec-muted); }
      .split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    `;
  }
  html() {
    const c = this._config, h = this._hass, e = c.entities;
    const idle = c.idle_threshold ?? 20;
    const soc = num(h, e.soc);
    const p = watts(h, e.power);
    const charging = p != null && p >= idle, discharging = p != null && p <= -idle;
    const stateTxt = charging ? "Charging" : discharging ? "Discharging" : "Idle";
    const col = discharging ? "var(--kec-batt-out)" : charging ? "var(--kec-batt-in)" : "var(--kec-muted)";
    const socCol = soc == null ? "var(--kec-muted)" : soc < 15 ? "var(--kec-bad)" : soc < 30 ? "var(--kec-warn)" : "var(--kec-ok)";
    const ttf = fmtMinutes(num(h, e.time_to_full)), tte = fmtMinutes(num(h, e.time_to_empty));
    const eta = charging && ttf ? `Full in ${ttf}` : discharging && tte ? `Empty in ${tte}` : "";

    const tile = (key, label, valueHtml) => e[key] ? `<div class="tile" data-entity="${esc(eid(e[key]))}"><div class="lbl">${label}</div><div class="val">${valueHtml}</div></div>` : "";
    const u = (v, unit) => `${v}<small>${unit}</small>`;

    const I = num(h, e.current), V = volts(h, e.voltage);
    // Ah stored, with the bank size when both capacity sensors exist (to_empty + to_full).
    const ce = num(h, e.capacity_to_empty), cf = num(h, e.capacity_to_full);
    const stored = e.capacity_to_empty ? `<div class="tile" data-entity="${esc(eid(e.capacity_to_empty))}"><div class="lbl">Stored Ah</div>
      <div class="val">${fmt(ce, 0)}${ce != null && cf != null ? `<small>/${(ce + cf).toFixed(0)}</small>` : ""}</div></div>`
      : tile("capacity_to_full", "To fill", u(fmt(cf, 0), "Ah"));
    const top = `<div class="top">
      <div class="socwrap" data-entity="${esc(eid(e.soc))}">${ring(soc, { color: socCol })}
        <div class="center"><div class="pct">${soc == null ? "—" : soc.toFixed(soc < 10 ? 1 : 0)}<small>%</small></div><div class="sub">SOC</div></div></div>
      <div class="kv">
        ${tile("power", "Power", u(p == null ? "—" : (Math.abs(p) / 1000).toFixed(2), "kW"))}
        ${tile("current", "Current", u(I == null ? "—" : Math.abs(I).toFixed(1), "A"))}
        ${tile("voltage", "Voltage", u(V == null ? "—" : V.toFixed(2), "V"))}
        ${e.time_to_full || e.time_to_empty ? `<div class="tile" data-entity="${esc(eid(charging ? e.time_to_full : e.time_to_empty) || eid(e.time_to_full))}">
            <div class="lbl">${charging ? "Full in" : discharging ? "Empty in" : "Time left"}</div><div class="val">${esc((charging ? ttf : discharging ? tte : null) ?? "—")}</div></div>` : ""}
        ${stored}
      </div></div>`;

    // Cell spread: min..max band on the configured range.
    let spread = "";
    const cmin = volts(h, e.cell_min), cmax = volts(h, e.cell_max);
    const [lo, hi] = c.cell_range ?? [3.0, 4.2];
    if (cmin != null && cmax != null) {
      const sp = cmax - cmin;
      const warn = sp > (c.spread_warn ?? 0.05);
      const x = (v) => clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
      spread = `<div class="section"><span class="lbl">Cell voltage</span>
        <div class="spread">
          <div class="val click" data-entity="${esc(eid(e.cell_min))}">${cmin.toFixed(3)}<small>V</small></div>
          <div class="rng"><div class="bar"></div><div class="band" style="left:${x(cmin)}%;width:calc(${x(cmax) - x(cmin)}% + 4px);--c:${warn ? "var(--kec-warn)" : "var(--kec-ok)"}"></div></div>
          <div class="val click" data-entity="${esc(eid(e.cell_max))}">${cmax.toFixed(3)}<small>V</small></div>
        </div>
        <div class="lbl ${warn ? "warn" : ""}" style="text-align:center;text-transform:none;letter-spacing:0">Spread ${(sp * 1000).toFixed(0)} mV</div>
      </div>`;
    }

    // Per-cell bars.
    let cells = "";
    const cl = this._cells();
    if (cl.length) {
      const vs = cl.map((s) => volts(h, s));
      const known = vs.filter((v) => v != null);
      const vmin = Math.min(...known), vmax = Math.max(...known);
      // Zoom the bars to the spread so small imbalances are visible, with 20 mV of headroom.
      const zlo = Math.max(lo, vmin - 0.02), zhi = Math.min(hi, vmax + 0.02);
      cells = `<div class="section"><span class="lbl" style="display:flex;justify-content:space-between">
          <span>Cells · ${zlo.toFixed(2)}–${zhi.toFixed(2)} V</span>
          ${vmax !== vmin ? `<span style="text-transform:none;letter-spacing:0"><span style="color:var(--kec-warn)">■</span> high <span style="color:var(--kec-batt-out)">■</span> low</span>` : ""}</span>
        <div class="cells" style="--n:${cl.length}">${cl.map((s, i) => {
          const v = vs[i];
          const pct = v == null ? 0 : clamp(((v - zlo) / (zhi - zlo || 1)) * 100, 4, 100);
          const ccol = v == null ? "var(--kec-track)" : v === vmax && vmax !== vmin ? "var(--kec-warn)" : v === vmin && vmax !== vmin ? "var(--kec-batt-out)" : "var(--kec-home)";
          return `<div class="cell" data-entity="${esc(s.entity)}" title="Cell ${i + 1}: ${v == null ? "—" : v.toFixed(3) + " V"}"><i style="height:${pct}%;--c:${ccol}"></i></div>`;
        }).join("")}</div>
        <div class="cellnums" style="--n:${cl.length}">${cl.map((_, i) => `<span>${i + 1}</span>`).join("")}</div></div>`;
    }

    const T1 = temp(h, e.temp_min), T2 = temp(h, e.temp_max);
    const tmin = T1.v, tmax = T2.v, tunit = e.temp_max ? T2.unit : T1.unit;
    const lower = [
      e.temp_min || e.temp_max ? `<div class="tile" data-entity="${esc(eid(e.temp_max || e.temp_min))}"><div class="lbl">Cell temp</div>
         <div class="val">${tmin == null ? "" : tmin.toFixed(0)}${tmin != null && tmax != null ? "–" : ""}${tmax == null ? "" : tmax.toFixed(0)}<small>${esc(tunit)}</small></div></div>` : "",
      tile("charge_limit", "Charge limit", u(fmt(num(h, e.charge_limit), 0), "A")),
      tile("discharge_limit", "Discharge limit", u(fmt(num(h, e.discharge_limit), 0), "A")),
      tile("energy_in", "Today in", u(fmt(kwh(h, e.energy_in), 1), "kWh")),
      tile("energy_out", "Today out", u(fmt(kwh(h, e.energy_out), 1), "kWh")),
    ].join("");

    return `<ha-card>
      <div class="head"><ha-icon icon="${esc(c.icon ?? "mdi:car-battery")}"></ha-icon><div class="title">${esc(c.name ?? "Battery")}</div>
        ${eta ? `<span class="muted" style="font-size:.8rem">${esc(eta)}</span>` : ""}
        <span class="chip" style="--chip:${col}">${stateTxt}</span></div>
      ${top}${spread}${cells}
      ${lower ? `<div class="section tiles">${lower}</div>` : ""}
    </ha-card>`;
  }
}

/* -------------------------------------------------------------- circuits-card */
/*
 * type: custom:circuits-card
 * title: Circuits
 * total: sensor.emporia_total_power          # optional; header + bar scale
 * balance: sensor.emporia_balance_power      # optional; listed as "Unmonitored"
 * entities:                                  # explicit list (names optional)
 *   - sensor.heat_pump_power
 *   - { entity: sensor.kitchen_south_power, name: Kitchen / DW }
 * match: "^sensor\\.emporiavue2_.*_power$"  # or: every W/kW sensor whose id matches
 * auto: emporia_vue          # or: every W/kW sensor from this integration (registry platform)
 * exclude: [sensor.emporia_total_power]
 * strip: "Emporia "          # text removed from the start of names
 * max: 8                     # rows before "show all"
 * hide_below: 0              # W; rows under this are folded into "show all"
 */
class CircuitsCard extends KecBase {
  validate(c) {
    if (!c.entities && !c.auto && !c.match) throw new Error("Set entities:, match: <regex> or auto: <integration>");
  }
  _list() {
    const c = this._config, h = this._hass;
    let list = (c.entities || []).map(spec);
    if (c.match) {
      const re = new RegExp(c.match);
      const have = new Set(list.map((s) => s.entity));
      for (const id of Object.keys(h.states)) {
        if (!id.startsWith("sensor.") || have.has(id) || !re.test(id)) continue;
        const u = (h.states[id].attributes?.unit_of_measurement || "").toLowerCase();
        if (u === "w" || u === "kw") list.push({ entity: id });
      }
    }
    if (c.auto && h.entities) {
      const have = new Set(list.map((s) => s.entity));
      for (const [id, reg] of Object.entries(h.entities)) {
        if (reg.platform !== c.auto || !id.startsWith("sensor.") || have.has(id) || reg.hidden) continue;
        const u = (h.states[id]?.attributes?.unit_of_measurement || "").toLowerCase();
        if (u === "w" || u === "kw") list.push({ entity: id });
      }
    }
    const ex = new Set([...(c.exclude || []), eid(c.total), eid(c.balance)].filter(Boolean));
    return list.filter((s) => !ex.has(s.entity));
  }
  watched() { return ids(this._config.total, this._config.balance, this._list ? this._list() : []); }
  getCardSize() { return 2 + Math.min(this._config.max ?? 8, 12) / 2; }
  css() {
    return `
      .total { display: flex; align-items: baseline; gap: 6px; margin: -4px 0 10px; }
      .total .big { font-size: 1.7rem; font-weight: 600; font-variant-numeric: tabular-nums; }
      .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 6px 2px; cursor: pointer; border-radius: 8px; }
      .row:hover { background: var(--kec-tile); }
      .row .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .92rem; }
      .row .w { font-variant-numeric: tabular-nums; font-size: .92rem; text-align: right; }
      .row .bar { grid-column: 1 / -1; height: 5px; }
      .row.zero .name, .row.zero .w { color: var(--kec-muted); }
      .more { margin-top: 6px; width: 100%; background: none; border: 1px solid var(--kec-track); border-radius: 10px;
              color: var(--kec-muted); padding: 7px; font: inherit; font-size: .85rem; cursor: pointer; }
      .more:hover { color: var(--primary-text-color); }
    `;
  }
  html() {
    const c = this._config, h = this._hass;
    const name = (s) => {
      let n = s.name ?? h.states[s.entity]?.attributes?.friendly_name ?? s.entity;
      for (const p of [].concat(c.strip || [])) if (n.startsWith(p)) n = n.slice(p.length);
      return n.replace(/\s+power$/i, "");
    };
    const rows = this._list().map((s) => ({ s, w: Math.max(0, watts(h, s) ?? 0) })).sort((a, b) => b.w - a.w);
    const total = c.total ? watts(h, c.total) : rows.reduce((a, r) => a + r.w, 0);
    const bal = c.balance ? watts(h, c.balance) : null;
    if (bal != null) rows.push({ s: { entity: eid(c.balance), name: c.balance_name ?? "Unmonitored" }, w: Math.max(0, bal), balance: true });
    rows.sort((a, b) => b.w - a.w);
    const scale = Math.max(total || 0, ...rows.map((r) => r.w), 1);
    const max = c.max ?? 8, hb = c.hide_below ?? 0;
    const shown = this._expanded ? rows : rows.filter((r, i) => i < max && (r.w >= hb || r.balance));
    const rest = rows.length - shown.length;
    const restW = rows.filter((r) => !shown.includes(r)).reduce((a, r) => a + r.w, 0);
    const row = (r) => `<div class="row ${r.w < 5 ? "zero" : ""}" data-entity="${esc(r.s.entity)}">
        <div class="name">${esc(name(r.s))}</div><div class="w">${fmtPower(r.w)}</div>
        <div class="bar"><i style="width:${(r.w / scale) * 100}%;--c:${r.balance ? "var(--kec-muted)" : "var(--kec-home)"}"></i></div></div>`;
    return `<ha-card>
      <div class="head"><ha-icon icon="${esc(c.icon ?? "mdi:flash")}"></ha-icon><div class="title">${esc(c.title ?? "Circuits")}</div></div>
      <div class="total ${c.total ? "click" : ""}" ${c.total ? `data-entity="${esc(eid(c.total))}"` : ""}>
        <span class="big">${fmtPower(total)}</span><span class="muted">${c.total ? "total" : "sum of circuits"}</span></div>
      ${shown.map(row).join("")}
      ${rest > 0 || this._expanded ? `<button class="more" id="more">${this._expanded ? "Show fewer" : `Show ${rest} more · ${fmtPower(restW)}`}</button>` : ""}
    </ha-card>`;
  }
  bind() {
    const b = this.shadowRoot.getElementById("more");
    if (b) b.addEventListener("click", () => { this._expanded = !this._expanded; this.update(); });
  }
}

/* -------------------------------------------------------------- inverter-card */
/*
 * type: custom:inverter-card
 * title: SolArk
 * pv:                      # strings; total optional (else summed)
 *   total: sensor.solark_pv_power
 *   strings:               # any number; a string whose sensor doesn't exist is hidden
 *     - { entity: sensor.solark_pv1_power, name: PV1 }
 *     - { entity: sensor.solark_pv2_power, name: PV2 }
 *     - { entity: sensor.solark_pv3_power, name: PV3 }
 *   show_missing: false    # true to show them anyway (as "—")
 *   capacity: 12000        # W; bar scale (optional)
 * legs: [ { entity: sensor.solark_inverter_l1_power, name: L1 }, { entity: sensor.solark_inverter_l2_power, name: L2 } ]
 * load: sensor.solark_load_power
 * grid:
 *   voltage: sensor.solark_grid_voltage
 *   frequency: sensor.solark_grid_frequency
 *   relay: sensor.solark_grid_relay
 * battery:                 # inverter's view of the whole bank
 *   power: { entity: sensor.solark_battery_power, invert: true }
 *   current: { entity: sensor.solark_battery_current, invert: true }
 *   voltage: sensor.solark_battery_voltage
 * today:                   # any energy sensors, shown as tiles
 *   - { entity: sensor.solark_pv_energy, name: PV }
 *   - { entity: sensor.solark_load_energy, name: Load }
 *   - { entity: sensor.solark_grid_buy_energy, name: Bought }
 */
class InverterCard extends KecBase {
  watched() {
    const c = this._config;
    return ids(c.pv?.total, c.pv?.strings || [], c.legs || [], c.load, c.grid?.voltage, c.grid?.frequency, c.grid?.relay,
      c.battery?.power, c.battery?.current, c.battery?.voltage, c.today || []);
  }
  getCardSize() { return 6; }
  css() {
    return `
      .pvhead { display: flex; align-items: baseline; gap: 6px; }
      .pvhead .big { font-size: 1.7rem; font-weight: 600; font-variant-numeric: tabular-nums; }
      .str { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: center; margin-top: 6px; cursor: pointer; }
      .str .w { font-variant-numeric: tabular-nums; font-size: .92rem; min-width: 64px; text-align: right; }
      .legs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .leg .bar { margin-top: 6px; }
      .gridrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    `;
  }
  html() {
    const c = this._config, h = this._hass;
    const u = (v, unit) => `${v}<small>${unit}</small>`;
    // Strings whose sensor doesn't exist yet (e.g. an unused PV3 input) are hidden until it does.
    const strings = (c.pv?.strings || []).map(spec).filter((s) => c.pv.show_missing || h.states[s.entity]);
    const sw = strings.map((s) => { const w = watts(h, s); return w == null ? null : Math.max(0, w); });
    const pvTotal = c.pv?.total ? Math.max(0, watts(h, c.pv.total) ?? 0) : sw.reduce((a, b) => a + (b ?? 0), 0);
    const cap = c.pv?.capacity ?? Math.max(pvTotal, ...sw.map((w) => w ?? 0), 1);

    const pv = c.pv ? `<div class="section" style="margin-top:0">
        <div class="pvhead ${c.pv.total ? "click" : ""}" ${c.pv.total ? `data-entity="${esc(eid(c.pv.total))}"` : ""}>
          <span class="big">${fmtPower(pvTotal)}</span><span class="muted">solar${c.pv.capacity ? ` · ${Math.round((pvTotal / c.pv.capacity) * 100)}% of ${fmtPower(c.pv.capacity)}` : ""}</span></div>
        ${strings.map((s, i) => `<div class="str" data-entity="${esc(s.entity)}"><span class="lbl">${esc(s.name ?? `PV${i + 1}`)}</span>
          <div class="bar"><i style="width:${((sw[i] ?? 0) / (c.pv.capacity ? c.pv.capacity / Math.max(strings.length, 1) : cap)) * 100}%;--c:var(--kec-solar)"></i></div>
          <span class="w">${fmtPower(sw[i])}</span></div>`).join("")}
      </div>` : "";

    const legs = (c.legs || []).map(spec);
    const lw = legs.map((s) => watts(h, s));
    const lmax = Math.max(...lw.map((w) => Math.abs(w ?? 0)), 1);
    const load = c.load ? watts(h, c.load) : null;
    const ac = legs.length || c.load ? `<div class="section"><span class="lbl">AC output${load != null ? ` · load ${fmtPower(load)}` : ""}</span>
        <div class="legs">${legs.map((s, i) => `<div class="tile leg" data-entity="${esc(s.entity)}"><div class="lbl">${esc(s.name ?? `L${i + 1}`)}</div>
          <div class="val">${fmtPower(lw[i])}</div><div class="bar"><i style="width:${(Math.abs(lw[i] ?? 0) / lmax) * 100}%;--c:var(--kec-home)"></i></div></div>`).join("")}</div>
      </div>` : "";

    const relay = c.grid?.relay ? stateObj(h, c.grid.relay)?.state : null;
    const closed = relay != null && /^(closed|on|connected|1|true)$/i.test(relay);
    const hz = num(h, c.grid?.frequency), gv = volts(h, c.grid?.voltage);
    const hzBad = hz != null && Math.abs(hz - (c.grid?.nominal_hz ?? 60)) > 0.5;
    const grid = c.grid ? `<div class="section"><span class="lbl">Grid</span><div class="gridrow">
        ${c.grid.voltage ? `<div class="tile" data-entity="${esc(eid(c.grid.voltage))}"><div class="lbl">Voltage</div><div class="val">${u(fmt(gv, 0), "V")}</div></div>` : ""}
        ${c.grid.frequency ? `<div class="tile" data-entity="${esc(eid(c.grid.frequency))}"><div class="lbl">Frequency</div><div class="val ${hzBad ? "warn" : ""}">${u(fmt(hz, 2), "Hz")}</div></div>` : ""}
        ${c.grid.relay ? `<div class="tile" data-entity="${esc(eid(c.grid.relay))}"><div class="lbl">Relay</div><div class="val" style="color:${closed ? "var(--kec-ok)" : "var(--kec-warn)"}">${esc(relay ?? "—")}</div></div>` : ""}
      </div></div>` : "";

    let batt = "";
    if (c.battery) {
      const bp = watts(h, c.battery.power), bi = num(h, c.battery.current), bv = volts(h, c.battery.voltage);
      const ch = bp != null && bp >= 20, dis = bp != null && bp <= -20;
      batt = `<div class="section"><span class="lbl">Battery bus · ${ch ? "charging" : dis ? "discharging" : "idle"}</span><div class="gridrow">
        ${c.battery.power ? `<div class="tile" data-entity="${esc(eid(c.battery.power))}"><div class="lbl">Power</div><div class="val" style="color:${dis ? "var(--kec-batt-out)" : ch ? "var(--kec-batt-in)" : "inherit"}">${fmtPower(bp == null ? null : Math.abs(bp))}</div></div>` : ""}
        ${c.battery.current ? `<div class="tile" data-entity="${esc(eid(c.battery.current))}"><div class="lbl">Current</div><div class="val">${u(bi == null ? "—" : Math.abs(bi).toFixed(1), "A")}</div></div>` : ""}
        ${c.battery.voltage ? `<div class="tile" data-entity="${esc(eid(c.battery.voltage))}"><div class="lbl">Voltage</div><div class="val">${u(fmt(bv, 2), "V")}</div></div>` : ""}
      </div></div>`;
    }

    const today = (c.today || []).map(spec);
    const todayHtml = today.length ? `<div class="section"><span class="lbl">Today</span><div class="tiles">
        ${today.map((s) => `<div class="tile" data-entity="${esc(s.entity)}"><div class="lbl">${esc(s.name ?? h.states[s.entity]?.attributes?.friendly_name ?? s.entity)}</div>
          <div class="val">${u(fmt(kwh(h, s), 1), "kWh")}</div></div>`).join("")}</div></div>` : "";

    return `<ha-card>
      <div class="head"><ha-icon icon="${esc(c.icon ?? "mdi:solar-power")}"></ha-icon><div class="title">${esc(c.title ?? "Inverter")}</div>
        ${c.grid?.relay ? `<span class="chip" style="--chip:${closed ? "var(--kec-ok)" : "var(--kec-warn)"}">${closed ? "Grid connected" : "Off-grid"}</span>` : ""}</div>
      ${pv}${ac}${batt}${grid}${todayHtml}
    </ha-card>`;
  }
}

/* ------------------------------------------------------------- registration */

const CARDS = [
  ["energy-flow-card", EnergyFlowCard, "Energy flow", "Live solar / grid / home / battery power flow"],
  ["battery-bank-card", BatteryBankCard, "Battery bank", "SOC, power, time to full/empty, cell spread and per-cell bars"],
  ["circuits-card", CircuitsCard, "Circuits", "Circuit power sorted by load (Emporia Vue or any power sensors)"],
  ["inverter-card", InverterCard, "Inverter", "PV strings, AC legs, grid and battery bus, today's energy"],
];
window.customCards = window.customCards || [];
for (const [tag, cls, name, description] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) window.customCards.push({ type: tag, name, description, preview: false });
}
console.info(`%c krogo-energy-cards %c ${VERSION} `, "background:#ff9800;color:#000;font-weight:600", "background:#333;color:#fff");
