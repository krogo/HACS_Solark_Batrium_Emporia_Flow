# Changelog

## 1.3.1
- Inverter card: `leg_max` (and per-leg `max`) sets the bar range for the AC legs; bars turn amber above 90 %. Also in the visual editor.

## 1.3.0
- Visual editor for all four cards (Home Assistant's own form fields). Existing YAML keeps working; options the editor doesn't show are preserved.
- Cards added from the picker start with auto-detected sensors (preferring ones that are updating, so stale leftovers of an old setup are skipped) and show live previews.
- An empty card shows a hint to open the editor instead of a configuration error.

## 1.2.2
- Card picker names end in "(krogo)" so searching "krogo" lists all four cards.

## 1.2.1
- Inverter card: any number of PV strings; strings whose sensor doesn't exist are hidden (`show_missing: true` shows them as "—").

## 1.2.0
- Live power flow card (`custom:energy-flow-card`).

## 1.1.0
- Inverter, battery bank and circuits cards. Units read from each sensor (W/kW, V/mV, Wh/kWh, °C/°F); per-entity `invert`.
