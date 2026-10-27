// Shelly double-push memory
// Double push below 100 % -> remember current level, go to 100 %
// Double push at 100 %    -> return to the remembered level
// Double push when off    -> switch on at 100 % (remembered level is kept)
// Works with and without the firmware double-push action (button_doublepush).
// With fastDetect the script reacts on the 2nd button release instead of
// waiting for the firmware double_push event (which arrives ~1 s later).
// Intended for all script-capable Shelly dimmers (Gen2/Gen3/Gen4/Pro).
// Gen1 (Shelly Dimmer / Dimmer 2) does not support scripts.

let CONFIG = {
  // Mapping button input -> light channel, adjust per device.
  // Inputs are counted from 0 (SW1 = input 0, SW2 = input 1, ...).
  //
  // One channel, one button (in_mode "dim"), applies to:
  //   Shelly Dimmer Gen3, Shelly Dimmer Gen4, Shelly Plus 0-10V Dimmer,
  //   Shelly Dimmer 0/1-10V PM Gen3, Shelly DALI Dimmer Gen3, Shelly Pro Dimmer 1PM
  //     [{ input: 0, light: 0 }]
  //
  // One channel, two buttons ("dual_dim": SW1 brighter, SW2 dimmer):
  //   same devices as above
  //     [{ input: 0, light: 0 }, { input: 1, light: 0 }]
  //
  // Shelly Pro Dimmer 2PM (two channels):
  //   one button per channel: [{ input: 0, light: 0 }, { input: 2, light: 1 }]
  //   dual_dim per channel:   [{ input: 0, light: 0 }, { input: 1, light: 0 },
  //                            { input: 2, light: 1 }, { input: 3, light: 1 }]
  //
  // Do NOT list inputs used for something else (e.g. detached for a scene),
  // otherwise a double push there triggers this function as well.
  // Input numbers can be checked with: http://<IP>/rpc/Shelly.GetStatus
  map: [{ input: 0, light: 0 }],
  full: 100,          // "full" brightness
  defaultSaved: 50,   // initial value until a level has been remembered
  settleMs: 800,      // level counts as "stable" once unchanged for this long
  actionDelayMs: 150, // wait for the firmware action to finish (only without fastDetect)
  // Fast detection via btn_down/btn_up. Disables the firmware double-push
  // action on start (button_doublepush = null), otherwise it would override
  // the result. Set to false if this is not wanted.
  fastDetect: true,
  doubleWindowMs: 500, // max. time between 1st and 2nd press
  maxPressMs: 500,     // 2nd press held longer = dimming, not a double push
  debug: true
};

let lights = {};

function log(msg) {
  if (CONFIG.debug) print("[dpmem] " + msg);
}

function kvsKey(id) {
  return "dpmem_light" + JSON.stringify(id);
}

function getLight(id) {
  let k = "l" + JSON.stringify(id);
  if (lights[k] === undefined) {
    lights[k] = {
      id: id, on: false, bri: 0,
      stable: null, cand: null, candTs: 0,
      saved: CONFIG.defaultSaved
    };
  }
  return lights[k];
}

// Effective level: 0 = off, otherwise brightness
function record(l) {
  let now = Shelly.getUptimeMs();
  let level = l.on ? l.bri : 0;
  if (l.cand !== null && now - l.candTs >= CONFIG.settleMs) l.stable = l.cand;
  l.cand = level;
  l.candTs = now;
}

function levelBefore(l) {
  let now = Shelly.getUptimeMs();
  if (l.cand !== null && now - l.candTs >= CONFIG.settleMs) l.stable = l.cand;
  return l.stable;
}

function setBrightness(id, b) {
  Shelly.call("Light.Set", { id: id, on: true, brightness: b });
}

function lightForInput(inputId) {
  for (let i = 0; i < CONFIG.map.length; i++) {
    if (CONFIG.map[i].input === inputId) return CONFIG.map[i].light;
  }
  return null;
}

// Init: load current state + remembered level
for (let i = 0; i < CONFIG.map.length; i++) {
  let l = getLight(CONFIG.map[i].light);
  if (l.initDone) continue;
  l.initDone = true;
  Shelly.call("Light.GetStatus", { id: l.id }, function (res, err, msg, l) {
    if (err !== 0 || !res) return;
    l.on = res.output;
    l.bri = res.brightness;
    l.stable = l.on ? l.bri : 0;
    l.cand = l.stable;
    l.candTs = Shelly.getUptimeMs() - CONFIG.settleMs;
    log("light " + JSON.stringify(l.id) + " start: " + JSON.stringify(l.stable));
  }, l);
  Shelly.call("KVS.Get", { key: kvsKey(l.id) }, function (res, err, msg, l) {
    if (err === 0 && res && res.value) {
      let v = JSON.parse(res.value);
      if (v > 0 && v < CONFIG.full) l.saved = v;
    }
    log("light " + JSON.stringify(l.id) + " gemerkt: " + JSON.stringify(l.saved));
  }, l);
  if (CONFIG.fastDetect) {
    Shelly.call("Light.SetConfig",
      { id: l.id, config: { button_presets: { button_doublepush: null } } },
      function (res, err, msg, l) {
        log("light " + JSON.stringify(l.id) + " Firmware-Doppelklick aus: " +
          (err === 0 ? "ok" : "Fehler " + JSON.stringify(err) + " " + msg));
      }, l);
  }
}

// Track brightness continuously
Shelly.addStatusHandler(function (ev) {
  if (ev.name !== "light" || !ev.delta) return;
  let l = getLight(ev.id);
  let changed = false;
  if (ev.delta.output !== undefined) { l.on = ev.delta.output; changed = true; }
  if (ev.delta.brightness !== undefined) { l.bri = ev.delta.brightness; changed = true; }
  if (changed) record(l);
});

// Fast detection state per input
let inputs = {};

function getInput(id) {
  let k = "i" + JSON.stringify(id);
  if (inputs[k] === undefined) inputs[k] = { firstDown: 0, lastDown: 0, presses: 0, doneAt: 0 };
  return inputs[k];
}

function handleDouble(lid, delay) {
  let l = getLight(lid);
  let prev = levelBefore(l);
  log("doppelklick light " + JSON.stringify(lid) + ", vorher: " + JSON.stringify(prev));
  if (prev === null) return;

  let target;
  let save = false;
  if (prev > 0 && prev < CONFIG.full) {
    l.saved = prev;
    save = true;
    target = CONFIG.full;
  } else if (prev >= CONFIG.full) {
    target = l.saved;
  } else {
    target = CONFIG.full; // was off
  }

  // Switch first, then save (KVS.Set is slow and would delay Light.Set)
  let apply = function () {
    log("light " + JSON.stringify(l.id) + " -> " + JSON.stringify(target));
    setBrightness(l.id, target);
    if (save) Shelly.call("KVS.Set", { key: kvsKey(l.id), value: JSON.stringify(prev) });
  };
  if (delay > 0) Timer.set(delay, false, apply);
  else apply();
}

// Handle double push
Shelly.addEventHandler(function (ev) {
  if (ev.name !== "input" || !ev.info) return;
  let e = ev.info.event;
  if (e !== "double_push" && e !== "btn_down" && e !== "btn_up") return;
  let lid = lightForInput(ev.id);
  if (lid === null) return;
  let inp = getInput(ev.id);
  // Use the input timestamp, independent of script latency
  let t = ev.info.ts !== undefined ? ev.info.ts * 1000 : Shelly.getUptimeMs();

  if (e === "double_push") {
    // already handled by fast detection?
    if (Shelly.getUptimeMs() - inp.doneAt < 3000) return;
    handleDouble(lid, CONFIG.actionDelayMs);
    return;
  }
  if (!CONFIG.fastDetect) return;

  if (e === "btn_down") {
    if (inp.presses === 0 || t - inp.firstDown > CONFIG.doubleWindowMs) {
      inp.firstDown = t;
      inp.presses = 0;
    }
    inp.presses++;
    inp.lastDown = t;
    return;
  }

  // btn_up: exactly the 2nd short press within the window
  if (inp.presses === 2 && t - inp.lastDown <= CONFIG.maxPressMs) {
    inp.presses = 3; // a possible 3rd press does not trigger again
    inp.doneAt = Shelly.getUptimeMs();
    handleDouble(lid, 0);
  }
});

log("gestartet");
