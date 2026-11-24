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

const VERSION = "1.3.0";

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
  /** True when no entity is configured yet (fresh card from the picker). */
  isEmpty() { return false; }
  _hint() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head"><ha-icon icon="mdi:pencil"></ha-icon>
      <div class="title">${esc(this.constructor.label || "Card")}</div></div>
      <div class="muted">No sensors set yet. Open the card editor to choose them, or paste a YAML example from the README.</div></ha-card>`;
  }
  /** Full re-render. Subclasses with animations override to patch in place. */
  update() {
    if (this.isEmpty()) { this._built = false; return this._hint(); }
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
  static label = "Energy flow";
  isEmpty() { const c = this._config; return !eid(c.solar) && !eid(c.home) && !eid(c.battery) && !eid(c.grid); }
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
    const paths = Object.keys(N).filter((k) => eid(c[k])).map((k) =>
      `<path class="path" d="${P[k]}"/><path class="dots" id="d-${k}" d="${P[k]}"/>`).join("");
    const pos = (k) => `left:${(N[k][0] / 400) * 100}%;top:${(N[k][1] / 290) * 100}%`;
    const node = (k, icon, colorVar, extra = "") => eid(c[k]) ? `
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
    if (this.isEmpty()) { this._built = false; return this._hint(); }
    if (!this._built || !this.shadowRoot.getElementById("chip")) { super.update(); this._built = true; }
    const c = this._config, h = this._hass, $ = (id) => this.shadowRoot.getElementById(id);
    const idle = c.idle_threshold ?? 20;
    const has = (k) => !!eid(c[k]);
    const solar = has("solar") ? Math.max(0, watts(h, c.solar) ?? 0) : null;
    const home = has("home") ? Math.abs(watts(h, c.home) ?? 0) : null;
    const batt = has("battery") ? watts(h, c.battery) : null;   // + charging
    const grid = has("grid") ? watts(h, c.grid) : null;         // + importing

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

    if (has("solar")) {
      $("v-solar").textContent = fmtPower(solar);
      $("s-solar").textContent = "Solar";
      $("d-solar").style.stroke = "var(--kec-solar)";
      anim("solar", solar, true);
      $("n-solar").classList.toggle("dim", solar < idle);
    }
    if (has("home")) {
      $("v-home").textContent = fmtPower(home);
      $("s-home").textContent = "Home";
      $("d-home").style.stroke = "var(--kec-home)";
      anim("home", home, false);
    }
    if (has("grid")) {
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
    if (has("battery")) {
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
  static label = "Battery bank";
  isEmpty() { const e = this._config.entities || {}; return !eid(e.soc) && !eid(e.power); }
  _cells() {
    const cc = this._config.cells;
    if (!cc) return [];
    if (Array.isArray(cc)) return cc.map(spec).filter(Boolean);
    if (cc.entities) return cc.entities.map(spec).filter(Boolean);
    if (cc.pattern && cc.count) return Array.from({ length: cc.count }, (_, i) => ({ entity: cc.pattern.replace("{n}", i + 1) }));
    return [];
  }
  watched() { return ids(Object.values(this._config.entities || {}), this._cells()); }
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
    const c = this._config, h = this._hass, e = c.entities || {};
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
    const stored = e.capacity_to_empty ? `<div class="tile" data-entity="${esc(eid(e.capacity_to_empty))}"><div class="lbl">Stored</div>
      <div class="val">${fmt(ce, 0)}<small>${ce != null && cf != null ? `/${(ce + cf).toFixed(0)}` : ""}Ah</small></div></div>`
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
  static label = "Circuits";
  isEmpty() { const c = this._config; return !(c.entities || []).length && !c.auto && !c.match && !eid(c.total); }
  _list() {
    const c = this._config, h = this._hass;
    let list = (c.entities || []).map(spec).filter(Boolean);
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
  static label = "Inverter";
  isEmpty() { return this.watched().length === 0; }
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
    const strings = (c.pv?.strings || []).map(spec).filter(Boolean).filter((s) => c.pv.show_missing || h.states[s.entity]);
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

    const legs = (c.legs || []).map(spec).filter(Boolean);
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

    const today = (c.today || []).map(spec).filter(Boolean);
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

/* ------------------------------------------------------------ visual editor */
/*
 * HA's ha-form edits flat data, and its expandable groups don't nest values.
 * The cards use nested config (battery: { entity, invert, soc }), so the editor
 * maps each form field to a path in the config and translates both ways.
 * Anything the editor doesn't know about (custom names, lists it doesn't show)
 * is left untouched.
 */

const S_POWER = { entity: { filter: [{ domain: "sensor" }] } };
const S_ENT = { entity: {} };
const S_BOOL = { boolean: {} };
const S_TEXT = { text: {} };
const S_ICON = { icon: {} };
const S_NUM = (min, max, step = 1, unit) => ({ number: { min, max, step, mode: "box", ...(unit ? { unit_of_measurement: unit } : {}) } });

/** Read a path; a plain "sensor.x" string stands in for { entity: "sensor.x" }. */
function getPath(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    if (cur == null) return undefined;
    if (typeof cur === "string") return k === "entity" && i === path.length - 1 ? cur : undefined;
    cur = cur[k];
  }
  return cur;
}

/** Write a path immutably; empty values remove the key; { entity } alone collapses to a string. */
function setPath(obj, path, value) {
  const empty = value === undefined || value === null || value === "" || value === false;
  const rec = (node, i) => {
    const k = path[i];
    if (typeof node === "string") node = { entity: node };
    const base = Array.isArray(node) ? [...node] : node == null && typeof k === "number" ? [] : { ...(node || {}) };
    if (i === path.length - 1) {
      if (empty) { if (Array.isArray(base)) base[k] = undefined; else delete base[k]; }
      else base[k] = value;
    } else {
      const child = rec(base[k], i + 1);
      if (child === undefined) { if (Array.isArray(base)) base[k] = undefined; else delete base[k]; }
      else base[k] = child;
    }
    if (Array.isArray(base)) {
      while (base.length && base[base.length - 1] === undefined) base.pop();
      return base.length ? base : undefined;
    }
    const keys = Object.keys(base);
    if (!keys.length) return undefined;
    if (keys.length === 1 && keys[0] === "entity" && typeof base.entity === "string") return base.entity;
    // A list item left holding only a name (its sensor was cleared) is dropped too.
    if (!("entity" in base) && keys.every((x) => x === "name") && path.some((x) => typeof x === "number")) return undefined;
    return base;
  };
  return rec(obj, 0) ?? {};
}

class KecEditor extends HTMLElement {
  /** fields: [{ key, path, selector, label, helper?, group? }] */
  static fields = [];
  setConfig(config) { this._config = config; this._render(); }
  set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; else this._render(); }
  _fields() { return this.constructor.fields; }
  _schema() {
    const groups = [];
    const byGroup = new Map();
    for (const f of this._fields()) {
      const item = { name: f.key, selector: f.selector };
      if (!f.group) { groups.push(item); continue; }
      if (!byGroup.has(f.group)) {
        const g = { type: "expandable", name: "", title: f.group, schema: [] };
        byGroup.set(f.group, g); groups.push(g);
      }
      byGroup.get(f.group).schema.push(item);
    }
    return groups;
  }
  _data() {
    const d = {};
    for (const f of this._fields()) {
      const v = f.get ? f.get(this._config) : getPath(this._config, f.path);
      if (v !== undefined) d[f.key] = v;
    }
    return d;
  }
  _render() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      const labels = Object.fromEntries(this._fields().map((f) => [f.key, f]));
      this._form.computeLabel = (s) => labels[s.name]?.label ?? s.title ?? s.name;
      this._form.computeHelper = (s) => labels[s.name]?.helper;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const data = ev.detail.value || {};
        let cfg = { ...this._config };
        for (const f of this._fields()) {
          const before = f.get ? f.get(this._config) : getPath(this._config, f.path);
          if (data[f.key] === before) continue;
          cfg = f.set ? f.set(cfg, data[f.key]) : setPath(cfg, f.path, data[f.key]);
        }
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = this._data();
  }
}

const F = (key, path, selector, label, group, helper) => ({ key, path, selector, label, group, helper });

class FlowEditor extends KecEditor {
  static fields = [
    F("title", ["title"], S_TEXT, "Title"),
    F("solar", ["solar", "entity"], S_POWER, "Solar power"),
    F("home", ["home", "entity"], S_POWER, "Home / load power"),
    F("battery", ["battery", "entity"], S_POWER, "Battery power", undefined, "Positive while charging (turn on Invert if not)"),
    F("battery_invert", ["battery", "invert"], S_BOOL, "Invert battery power"),
    F("battery_soc", ["battery", "soc"], S_ENT, "Battery state of charge"),
    F("grid", ["grid", "entity"], S_POWER, "Grid power", "Grid", "Positive while importing (turn on Invert if not)"),
    F("grid_invert", ["grid", "invert"], S_BOOL, "Invert grid power", "Grid"),
    F("grid_relay", ["grid", "relay"], S_ENT, "Grid relay / connection state", "Grid"),
    F("solar_invert", ["solar", "invert"], S_BOOL, "Invert solar power", "Advanced"),
    F("home_invert", ["home", "invert"], S_BOOL, "Invert home power", "Advanced"),
    F("idle_threshold", ["idle_threshold"], S_NUM(0, 1000, 5, "W"), "Idle below", "Advanced"),
  ];
}

const BB = (k, label, group, sel = S_ENT) => F(`e_${k}`, ["entities", k, "entity"], sel, label, group);
class BatteryEditor extends KecEditor {
  static fields = [
    F("name", ["name"], S_TEXT, "Name"),
    F("icon", ["icon"], S_ICON, "Icon"),
    BB("soc", "State of charge"),
    BB("power", "Power", undefined, S_POWER),
    F("power_invert", ["entities", "power", "invert"], S_BOOL, "Invert power (positive must mean charging)"),
    BB("current", "Current"),
    BB("voltage", "Voltage"),
    BB("time_to_full", "Time to full (minutes)", "Time and capacity"),
    BB("time_to_empty", "Time to empty (minutes)", "Time and capacity"),
    BB("capacity_to_full", "Capacity to full (Ah)", "Time and capacity"),
    BB("capacity_to_empty", "Capacity to empty / stored (Ah)", "Time and capacity"),
    BB("cell_min", "Lowest cell voltage", "Cells"),
    BB("cell_max", "Highest cell voltage", "Cells"),
    F("cells_pattern", ["cells", "pattern"], S_TEXT, "Per-cell sensor pattern", "Cells", "e.g. sensor.batrium_cell_{n}_voltage — {n} is the cell number"),
    F("cells_count", ["cells", "count"], S_NUM(1, 64), "Number of cells", "Cells"),
    { key: "cell_lo", selector: S_NUM(0, 5, 0.05, "V"), label: "Cell range low", group: "Cells",
      get: (c) => c.cell_range?.[0], set: (c, v) => ({ ...c, cell_range: [v ?? 3.0, c.cell_range?.[1] ?? 4.2] }) },
    { key: "cell_hi", selector: S_NUM(0, 5, 0.05, "V"), label: "Cell range high", group: "Cells",
      get: (c) => c.cell_range?.[1], set: (c, v) => ({ ...c, cell_range: [c.cell_range?.[0] ?? 3.0, v ?? 4.2] }) },
    F("spread_warn", ["spread_warn"], S_NUM(0, 1, 0.005, "V"), "Warn when spread exceeds", "Cells"),
    BB("temp_min", "Lowest temperature", "Temperature, limits and energy"),
    BB("temp_max", "Highest temperature", "Temperature, limits and energy"),
    BB("charge_limit", "Charge current limit", "Temperature, limits and energy"),
    BB("discharge_limit", "Discharge current limit", "Temperature, limits and energy"),
    BB("energy_in", "Energy in today", "Temperature, limits and energy"),
    BB("energy_out", "Energy out today", "Temperature, limits and energy"),
  ];
}

const pvF = (i) => [
  F(`pv${i}`, ["pv", "strings", i - 1, "entity"], S_POWER, `PV${i} power`, "Solar"),
];
class InverterEditor extends KecEditor {
  static fields = [
    F("title", ["title"], S_TEXT, "Title"),
    F("pv_total", ["pv", "total"], S_POWER, "Total PV power", "Solar"),
    ...pvF(1), ...pvF(2), ...pvF(3), ...pvF(4),
    F("pv_capacity", ["pv", "capacity"], S_NUM(0, 100000, 100, "W"), "Array capacity (optional)", "Solar"),
    F("l1", ["legs", 0, "entity"], S_POWER, "Leg L1 power", "AC output"),
    F("l2", ["legs", 1, "entity"], S_POWER, "Leg L2 power", "AC output"),
    F("load", ["load"], S_POWER, "Load power", "AC output"),
    F("b_power", ["battery", "power", "entity"], S_POWER, "Battery power", "Battery bus"),
    F("b_power_inv", ["battery", "power", "invert"], S_BOOL, "Invert battery power", "Battery bus"),
    F("b_current", ["battery", "current", "entity"], S_ENT, "Battery current", "Battery bus"),
    F("b_current_inv", ["battery", "current", "invert"], S_BOOL, "Invert battery current", "Battery bus"),
    F("b_voltage", ["battery", "voltage"], S_ENT, "Battery voltage", "Battery bus"),
    F("g_voltage", ["grid", "voltage"], S_ENT, "Grid voltage", "Grid"),
    F("g_freq", ["grid", "frequency"], S_ENT, "Grid frequency", "Grid"),
    F("g_relay", ["grid", "relay"], S_ENT, "Grid relay", "Grid"),
    ...[1, 2, 3, 4, 5, 6].flatMap((i) => [
      F(`t${i}`, ["today", i - 1, "entity"], S_ENT, `Today tile ${i}`, "Today"),
      F(`t${i}_name`, ["today", i - 1, "name"], S_TEXT, `Tile ${i} label`, "Today"),
    ]),
  ];
}
// PV strings and legs get default names when first set from the editor.
for (const [k, path, nm] of [...[1, 2, 3, 4].map((i) => [`pv${i}`, ["pv", "strings", i - 1], `PV${i}`]), ["l1", ["legs", 0], "L1"], ["l2", ["legs", 1], "L2"]]) {
  const f = InverterEditor.fields.find((x) => x.key === k);
  f.set = (c, v) => {
    let cfg = setPath(c, [...path, "entity"], v);
    const node = getPath(cfg, path);
    if (v && (typeof node === "string" || (node && !node.name))) cfg = setPath(cfg, [...path, "name"], nm);
    if (!v) cfg = setPath(cfg, path, undefined);
    return cfg;
  };
}

class CircuitsEditor extends KecEditor {
  static fields = [
    F("title", ["title"], S_TEXT, "Title"),
    F("total", ["total"], S_POWER, "Total power (optional)"),
    F("balance", ["balance"], S_POWER, "Unmonitored / balance power (optional)"),
    { key: "entities", selector: { entity: { multiple: true, filter: [{ domain: "sensor" }] } }, label: "Circuits",
      get: (c) => (c.entities || []).map(eid),
      // Keep custom names for circuits that stay selected.
      set: (c, v) => {
        const old = new Map((c.entities || []).map((s) => [eid(s), s]));
        const list = (v || []).map((id) => old.get(id) ?? id);
        const cfg = { ...c };
        if (list.length) cfg.entities = list; else delete cfg.entities;
        return cfg;
      } },
    F("max", ["max"], S_NUM(1, 50), "Rows before “Show more”"),
    F("strip", ["strip"], S_TEXT, "Remove from start of names", undefined, "e.g. vue2 "),
    F("hide_below", ["hide_below"], S_NUM(0, 10000, 1, "W"), "Fold rows below", "Advanced"),
    F("match", ["match"], S_TEXT, "Also include sensors whose id matches (regex)", "Advanced"),
  ];
}

/* ---------------------------------------------------- picker starting config */
/* Best-effort auto-detection so a card added from the picker shows real data. */

function sensorsBy(hass, re, units) {
  return Object.keys(hass?.states || {}).filter((id) => {
    if (!id.startsWith("sensor.") || !re.test(id)) return false;
    if (!units) return true;
    const u = (hass.states[id].attributes?.unit_of_measurement || "").toLowerCase();
    return units.includes(u);
  }).sort((a, b) => {
    // Prefer sensors that are actually updating (stale leftovers of an old setup often share a name),
    // then the shortest id.
    const t = (id) => Date.parse(hass.states[id].last_updated || hass.states[id].last_changed || 0) || 0;
    return t(b) - t(a) || a.length - b.length;
  });
}
const first = (hass, re, units) => sensorsBy(hass, re, units)[0];
const W = ["w", "kw"];

function stubFlow(hass) {
  const battery = first(hass, /(^|_)battery_power$/, W);
  const grid = first(hass, /(^|_)(total_)?grid_power$/, W);
  const cfg = { title: "Power flow" };
  const solar = first(hass, /(^|_)pv_(input_)?power$/, W) ?? first(hass, /solar.*power$/, W);
  const home = first(hass, /(^|_)load_power$/, W);
  if (solar) cfg.solar = { entity: solar };
  if (home) cfg.home = { entity: home };
  if (battery) {
    // SolArk reports battery power negative while charging.
    cfg.battery = { entity: battery, ...(/solark|sol_ark/.test(battery) ? { invert: true } : {}) };
    const soc = first(hass, /soc_coulomb$/, ["%"]) ?? first(hass, /(state_of_charge|_soc)$/, ["%"]);
    if (soc) cfg.battery.soc = soc;
  }
  if (grid) {
    cfg.grid = { entity: grid };
    const relay = first(hass, /grid_relay$/);
    if (relay) cfg.grid.relay = relay;
  }
  return cfg;
}

function stubInverter(hass) {
  const cfg = { title: "Inverter" };
  const total = first(hass, /(^|_)pv_(input_)?power$/, W);
  const strings = [1, 2, 3, 4].map((i) => [i, first(hass, new RegExp(`pv${i}_(input_)?power$`), W)]).filter(([, e]) => e);
  if (total || strings.length) cfg.pv = { ...(total ? { total } : {}), ...(strings.length ? { strings: strings.map(([i, entity]) => ({ entity, name: `PV${i}` })) } : {}) };
  const legs = [1, 2].map((i) => first(hass, new RegExp(`inverter_l${i}_power$`), W)).filter(Boolean);
  if (legs.length) cfg.legs = legs.map((entity, i) => ({ entity, name: `L${i + 1}` }));
  const load = first(hass, /(^|_)load_power$/, W);
  if (load) cfg.load = load;
  const bp = first(hass, /(^|_)battery_power$/, W), bi = first(hass, /(^|_)battery_current$/, ["a"]), bv = first(hass, /(^|_)battery_voltage$/, ["v"]);
  const inv = (e) => (e && /solark|sol_ark/.test(e) ? { entity: e, invert: true } : e);
  if (bp || bi || bv) cfg.battery = { ...(bp ? { power: inv(bp) } : {}), ...(bi ? { current: inv(bi) } : {}), ...(bv ? { voltage: bv } : {}) };
  const gv = first(hass, /grid_(l1_l2_)?voltage$/, ["v"]), gf = first(hass, /grid_frequency$/, ["hz"]), gr = first(hass, /grid_relay$/);
  if (gv || gf || gr) cfg.grid = { ...(gv ? { voltage: gv } : {}), ...(gf ? { frequency: gf } : {}), ...(gr ? { relay: gr } : {}) };
  const today = [["pv", "PV"], ["load", "Load"], ["battery_charge", "Batt in"], ["battery_discharge", "Batt out"], ["grid_buy", "Bought"], ["grid_sell", "Sold"]]
    .map(([k, name]) => [first(hass, new RegExp(`daily_${k}_energy$`), ["kwh", "wh"]), name]).filter(([e]) => e);
  if (today.length) cfg.today = today.map(([entity, name]) => ({ entity, name }));
  return cfg;
}

function stubBattery(hass) {
  const e = {};
  const put = (k, re, units) => { const x = first(hass, re, units); if (x) e[k] = x; };
  put("soc", /soc_coulomb$/, ["%"]); if (!e.soc) put("soc", /(state_of_charge|_soc)$/, ["%"]);
  put("power", /(pack|shunt)_power$/, W);
  put("current", /shunt_current$/, ["a"]);
  put("voltage", /pack_voltage$/, ["v"]);
  put("time_to_full", /time_to_full$/); put("time_to_empty", /time_to_empty$/);
  put("capacity_to_full", /capacity_to_full(_\d+)?$/, ["ah"]); put("capacity_to_empty", /capacity_to_empty(_\d+)?$/, ["ah"]);
  put("cell_min", /cell_voltage_min$/, ["v", "mv"]); put("cell_max", /cell_voltage_max$/, ["v", "mv"]);
  put("temp_min", /cell_temp_min$/); put("temp_max", /cell_temp_max$/);
  put("charge_limit", /charger_target_current$/); put("discharge_limit", /inverter_target_current$/);
  put("energy_in", /today_energy_in$/); put("energy_out", /today_energy_out$/);
  // Name the card after the device the sensors belong to ("Batrium SOC (Coulomb)" -> "Batrium").
  const devName = (hass.states[e.soc || e.power]?.attributes?.friendly_name || "").split(/\s+/)[0];
  const cfg = { name: devName || "Battery bank", icon: "mdi:car-battery", entities: e };
  // Per-cell sensors: sensor.<x>_cell_<n>_voltage, optionally with a _2 suffix; prefer the suffix that is live.
  const cells = sensorsBy(hass, /_cell_\d+_voltage(_\d+)?$/, ["v", "mv"]);
  if (cells.length) {
    const groups = new Map();
    for (const id of cells) {
      const m = id.match(/^(.*_cell_)(\d+)(_voltage(?:_\d+)?)$/);
      const key = m[1] + "{n}" + m[3];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(+m[2]);
    }
    // Choose the set of cell sensors that agrees with the live min/max cell voltage; then the freshest.
    const vals = (k) => groups.get(k).map((n) => volts(hass, k.replace("{n}", n))).filter((v) => v != null && v > 0);
    const lo = volts(hass, e.cell_min), hi = volts(hass, e.cell_max);
    const fit = (k) => { const v = vals(k); return lo == null || hi == null || !v.length ? 0 : Math.abs(Math.min(...v) - lo) + Math.abs(Math.max(...v) - hi); };
    const fresh = (k) => Math.max(...groups.get(k).map((n) => Date.parse(hass.states[k.replace("{n}", n)]?.last_updated || 0) || 0));
    const best = [...groups.keys()].sort((a, b) => fit(a) - fit(b) || fresh(b) - fresh(a) || groups.get(b).length - groups.get(a).length)[0];
    const nums = groups.get(best).filter((n) => (parseFloat(hass.states[best.replace("{n}", n)]?.state) || 0) > 0);
    if (nums.length) cfg.cells = { pattern: best, count: Math.max(...nums) };
  }
  return cfg;
}

function stubCircuits(hass) {
  const total = first(hass, /(emporia|vue).*total_power$/, W) ?? first(hass, /total_power$/, W);
  const cfg = { title: "Circuits", max: 8 };
  if (!total) return cfg;
  cfg.total = total;
  const prefix = total.replace(/total_power$/, "");
  const balance = first(hass, new RegExp("^" + prefix.replace(/\./g, "\\.") + "balance_power$"), W);
  if (balance) cfg.balance = balance;
  cfg.entities = sensorsBy(hass, new RegExp("^" + prefix.replace(/\./g, "\\.") + ".*_power(_\\d+)?$"), W)
    // Skip the mains legs (<prefix>phase_a_power), which add up to the total; keep circuits like building_phase_a_power.
    .filter((id) => id !== total && id !== balance && !/^phase_[a-c]_power$/.test(id.slice(prefix.length)));
  // Common friendly-name prefix (e.g. "vue2 ") is stripped from labels.
  const fn = hass.states[total]?.attributes?.friendly_name || "";
  const p = fn.match(/^(\S+\s)/)?.[1];
  if (p && cfg.entities.every((id) => (hass.states[id]?.attributes?.friendly_name || "").startsWith(p))) cfg.strip = p;
  return cfg;
}

EnergyFlowCard.getConfigElement = () => document.createElement("krogo-flow-editor");
EnergyFlowCard.getStubConfig = (hass) => stubFlow(hass);
BatteryBankCard.getConfigElement = () => document.createElement("krogo-battery-editor");
BatteryBankCard.getStubConfig = (hass) => stubBattery(hass);
InverterCard.getConfigElement = () => document.createElement("krogo-inverter-editor");
InverterCard.getStubConfig = (hass) => stubInverter(hass);
CircuitsCard.getConfigElement = () => document.createElement("krogo-circuits-editor");
CircuitsCard.getStubConfig = (hass) => stubCircuits(hass);
for (const [tag, cls] of [["krogo-flow-editor", FlowEditor], ["krogo-battery-editor", BatteryEditor],
                          ["krogo-inverter-editor", InverterEditor], ["krogo-circuits-editor", CircuitsEditor]])
  if (!customElements.get(tag)) customElements.define(tag, cls);

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
  // "krogo" in the name so the card picker's search finds all four together.
  if (!window.customCards.some((c) => c.type === tag))
    window.customCards.push({ type: tag, name: `${name} (krogo)`, description, preview: true, documentationURL: "https://github.com/krogo/HACS_Solark_Batrium_Emporia_Flow" });
}
console.info(`%c krogo-energy-cards %c ${VERSION} `, "background:#ff9800;color:#000;font-weight:600", "background:#333;color:#fff");
