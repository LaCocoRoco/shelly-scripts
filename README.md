# shelly-scripts

Scripts für script-fähige Shelly-Geräte (Gen2/Gen3/Gen4/Pro).

## doublepush_memory.js

Doppelklick-Memory für Shelly-Dimmer:

- Doppelklick bei < 100 % → aktuellen Wert merken, auf 100 % fahren
- Doppelklick bei 100 % → zurück auf den gemerkten Wert
- Doppelklick bei „aus“ → auf 100 % einschalten

Der gemerkte Wert wird im KVS gespeichert und übersteht einen Neustart.

Mit `fastDetect: true` (Standard) erkennt das Script den Doppelklick selbst
beim zweiten Loslassen des Tasters, statt auf das `double_push` der Firmware zu
warten (ca. 1 s schneller). Dafür schaltet es beim Start die Firmware-Aktion für
den Doppelklick ab (`button_presets.button_doublepush = null`).

Hinweis: Liegt zwischen den beiden Klicks weniger als ca. 70 ms, erkennt der
Eingang des Geräts nur einen Druck. Die Firmware wertet das dann als
Einfachklick und schaltet das Licht um.

### Installation

1. Weboberfläche des Shelly öffnen → *Scripts* → *Create script*
2. Inhalt von `doublepush_memory.js` einfügen
3. `CONFIG.map` an das Gerät anpassen (siehe Kommentare im Script)
4. Speichern, starten und *Run on startup* aktivieren
