// Shelly Doppelklick-Memory
// Doppelklick bei < 100 %  -> aktuellen Wert merken, auf 100 % fahren
// Doppelklick bei 100 %    -> zurück auf den gemerkten Wert
// Doppelklick bei "aus"    -> auf 100 % einschalten (gemerkter Wert bleibt)
// Funktioniert mit und ohne aktivem Firmware-Doppelklick (button_doublepush).
// Mit fastDetect reagiert das Script schon beim 2. Loslassen des Tasters statt
// erst auf das double_push der Firmware (das kommt ca. 1 s später).
// Gedacht für alle script-fähigen Shelly-Dimmer (Gen2/Gen3/Gen4/Pro).
// Gen1 (Shelly Dimmer / Dimmer 2) kann keine Scripts.

let CONFIG = {
  // Zuordnung Taster-Eingang -> Licht-Kanal, je Gerät anpassen.
  // Eingänge zählen ab 0 (SW1 = input 0, SW2 = input 1, ...).
  //
  // Ein Kanal, ein Taster (in_mode "dim"), gilt für:
  //   Shelly Dimmer Gen3, Shelly Dimmer Gen4, Shelly Plus 0-10V Dimmer,
  //   Shelly Dimmer 0/1-10V PM Gen3, Shelly DALI Dimmer Gen3, Shelly Pro Dimmer 1PM
  //     [{ input: 0, light: 0 }]
  //
  // Ein Kanal, zwei Taster auf ("dual_dim": SW1 heller, SW2 dunkler):
  //   gleiche Geräte wie oben
  //     [{ input: 0, light: 0 }, { input: 1, light: 0 }]
  //
  // Shelly Pro Dimmer 2PM (zwei Kanäle):
  //   ein Taster je Kanal:   [{ input: 0, light: 0 }, { input: 2, light: 1 }]
  //   dual_dim je Kanal:     [{ input: 0, light: 0 }, { input: 1, light: 0 },
  //                           { input: 2, light: 1 }, { input: 3, light: 1 }]
  //
  // Eingänge, die anders verwendet werden (z. B. getrennt für eine Szene),
  // NICHT eintragen, sonst löst auch dort ein Doppelklick die Funktion aus.
  // Die Nummern lassen sich prüfen mit: http://<IP>/rpc/Shelly.GetStatus
  map: [{ input: 0, light: 0 }],
  full: 100,          // "Voll"-Helligkeit
  defaultSaved: 50,   // Startwert, solange noch nichts gemerkt wurde
  settleMs: 800,      // Wert gilt als "stabil", wenn er so lange unverändert war
  actionDelayMs: 150, // kurz warten, bis die Firmware-Aktion durch ist (nur ohne fastDetect)
  // Schnellerkennung über btn_down/btn_up. Schaltet beim Start die
  // Firmware-Doppelklick-Aktion ab (button_doublepush = null), da diese sonst
  // das Ergebnis überschreibt. Auf false setzen, wenn das nicht gewünscht ist.
  fastDetect: true,
  doubleWindowMs: 500, // max. Zeit zwischen 1. und 2. Drücken
  maxPressMs: 500,     // 2. Druck länger gehalten = Dimmen, kein Doppelklick
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

// Effektiver Pegel: 0 = aus, sonst Helligkeit
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

// Initialisierung: aktuellen Zustand + gespeicherten Wert laden
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

// Helligkeit laufend verfolgen
Shelly.addStatusHandler(function (ev) {
  if (ev.name !== "light" || !ev.delta) return;
  let l = getLight(ev.id);
  let changed = false;
  if (ev.delta.output !== undefined) { l.on = ev.delta.output; changed = true; }
  if (ev.delta.brightness !== undefined) { l.bri = ev.delta.brightness; changed = true; }
  if (changed) record(l);
});

// Zustand der Schnellerkennung je Eingang
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
    target = CONFIG.full; // war aus
  }

  // Erst schalten, dann speichern (KVS.Set ist langsam und würde Light.Set verzögern)
  let apply = function () {
    log("light " + JSON.stringify(l.id) + " -> " + JSON.stringify(target));
    setBrightness(l.id, target);
    if (save) Shelly.call("KVS.Set", { key: kvsKey(l.id), value: JSON.stringify(prev) });
  };
  if (delay > 0) Timer.set(delay, false, apply);
  else apply();
}

// Doppelklick auswerten
Shelly.addEventHandler(function (ev) {
  if (ev.name !== "input" || !ev.info) return;
  let e = ev.info.event;
  if (e !== "double_push" && e !== "btn_down" && e !== "btn_up") return;
  let lid = lightForInput(ev.id);
  if (lid === null) return;
  let inp = getInput(ev.id);
  // Zeitstempel des Eingangs verwenden, unabhängig von der Script-Latenz
  let t = ev.info.ts !== undefined ? ev.info.ts * 1000 : Shelly.getUptimeMs();

  if (e === "double_push") {
    // schon per Schnellerkennung behandelt?
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

  // btn_up: genau der 2. kurze Druck innerhalb des Fensters
  if (inp.presses === 2 && t - inp.lastDown <= CONFIG.maxPressMs) {
    inp.presses = 3; // ein evtl. 3. Druck löst nicht erneut aus
    inp.doneAt = Shelly.getUptimeMs();
    handleDouble(lid, 0);
  }
});

log("gestartet");
