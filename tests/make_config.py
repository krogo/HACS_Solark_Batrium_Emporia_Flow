import json, yaml
circuits = ["building_phase_a","building_phase_b","heat_pump","water_heater","dryer","refrigerator","utility_room",
            "master_bed_room","kitchen_south_dishwasher_power_2","garage_phase_a","garage_phase_b","microwave","range"]
def cid(c): return f"sensor.emporiavue2_{c}" if c.endswith("_2") else f"sensor.emporiavue2_{c}_power"
cards = [
  {"type":"custom:energy-flow-card","title":"Power flow",
   "solar":{"entity":"sensor.solark_pv_input_power"},
   "home":{"entity":"sensor.solark_load_power"},
   "battery":{"entity":"sensor.solark_battery_power","invert":True,"soc":"sensor.batrium_soc_coulomb"},
   "grid":{"entity":"sensor.solark_total_grid_power","relay":"sensor.solark_grid_relay"}},
  {"type":"custom:inverter-card","title":"SolArk",
   "pv":{"total":"sensor.solark_pv_input_power",
         "strings":[{"entity":"sensor.solark_pv1_input_power","name":"PV1"},{"entity":"sensor.solark_pv2_input_power","name":"PV2"},
                     {"entity":"sensor.solark_pv3_input_power","name":"PV3"}]},
   "legs":[{"entity":"sensor.solark_inverter_l1_power","name":"L1"},{"entity":"sensor.solark_inverter_l2_power","name":"L2"}],
   "load":"sensor.solark_load_power",
   "battery":{"power":{"entity":"sensor.solark_battery_power","invert":True},
              "current":{"entity":"sensor.solark_battery_current","invert":True},
              "voltage":"sensor.solark_battery_voltage"},
   "grid":{"voltage":"sensor.solark_grid_l1_l2_voltage","frequency":"sensor.solark_grid_frequency","relay":"sensor.solark_grid_relay"},
   "today":[{"entity":"sensor.solark_daily_pv_energy","name":"PV"},
            {"entity":"sensor.solark_daily_load_energy","name":"Load"},
            {"entity":"sensor.solark_daily_battery_charge_energy","name":"Batt in"},
            {"entity":"sensor.solark_daily_battery_discharge_energy","name":"Batt out"},
            {"entity":"sensor.solark_daily_grid_buy_energy","name":"Bought"},
            {"entity":"sensor.solark_daily_grid_sell_energy","name":"Sold"}]},
  {"type":"custom:battery-bank-card","name":"Batrium pack","icon":"mdi:car-battery",
   "entities":{
     "soc":"sensor.batrium_soc_coulomb","power":"sensor.batrium_pack_power","current":"sensor.batrium_shunt_current",
     "voltage":"sensor.batrium_pack_voltage",
     "time_to_full":"sensor.batrium_estimated_time_to_full","time_to_empty":"sensor.batrium_estimated_time_to_empty",
     "capacity_to_full":"sensor.batrium_capacity_to_full_2","capacity_to_empty":"sensor.batrium_capacity_to_empty_2",
     "cell_min":"sensor.batrium_cell_voltage_min","cell_max":"sensor.batrium_cell_voltage_max",
     "temp_min":"sensor.batrium_cell_temp_min","temp_max":"sensor.batrium_cell_temp_max",
     "charge_limit":"sensor.batrium_charger_target_current","discharge_limit":"sensor.batrium_inverter_target_current",
     "energy_in":"sensor.batrium_today_energy_in","energy_out":"sensor.batrium_today_energy_out"},
   "cells":{"pattern":"sensor.batrium_cell_{n}_voltage_2","count":14},
   "cell_range":[3.0,4.2]},
  {"type":"custom:circuits-card","title":"Circuits","icon":"mdi:home-lightning-bolt",
   "total":"sensor.emporiavue2_total_power","balance":"sensor.emporiavue2_balance_power",
   "strip":"vue2 ","max":8,
   "entities":[cid(c) for c in circuits]},
]
json.dump(cards, open("tests/cards.json","w"), indent=1)
class D(yaml.SafeDumper): pass
D.add_representer(str, lambda d, v: d.represent_scalar('tag:yaml.org,2002:str', v))
with open("examples/ken-solark-batrium-emporia.yaml","w") as f:
    f.write("# Example cards for the krogo energy cards, wired to the entity IDs you sent.\n"
            "# Paste each card into a dashboard (Edit dashboard -> Add card -> Manual), or use the\n"
            "# whole list under `cards:` in a vertical-stack / sections view.\n\n")
    yaml.dump(cards, f, Dumper=D, sort_keys=False, allow_unicode=True, width=120)
print(open("examples/ken-solark-batrium-emporia.yaml").read()[:600])
