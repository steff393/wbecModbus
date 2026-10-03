# wbecModbus – Entwicklerdoku

> Für Nutzer siehe [README.md](../README.md) (Kurzanleitung) und [HILFE.md](HILFE.md) (ausführliche Anleitung).

Eine lokale Hardware-Bridge, die einen Browser mit **Modbus-TCP-Geräten** verbindet – z.B.
um einen Wechselrichter auszulesen, ohne zusätzliche Software installieren zu müssen.

Die Anwendung besteht aus einer kleinen portablen `wbecModbus.exe`, die

1. eine lokale HTTP-API bereitstellt,
2. die Weboberfläche ausliefert (in die EXE eingebettet) und
3. per Modbus TCP mit dem Gerät kommuniziert.

```
Browser  ──HTTP──►  127.0.0.1:8765 (wbecModbus.exe)  ──Modbus TCP──►  Wechselrichter
```

Die Bridge lauscht **ausschließlich auf `127.0.0.1:8765`** und ist damit nicht aus dem
Netzwerk erreichbar. Die Anwendung ist bewusst **Read-Only** (nur FC03/FC04) – es können
keine Geräteparameter verändert werden.

---

## Build & Start

Voraussetzung: Go (siehe `go.mod`). Einzige Abhängigkeit: `github.com/goburrow/modbus`.

```sh
go build          # erzeugt wbecModbus.exe (bzw. wbecmodbus unter Linux)
go run .          # bauen + starten in einem Schritt
go run . -dev     # Entwicklung: web/ wird von der Platte geladen (Datei ändern + Browser neu laden, kein Rebuild)
```

Beim Start öffnet die EXE die Oberfläche <http://127.0.0.1:8765> automatisch im Standardbrowser und zeigt
die Adresse deutlich im Konsolenfenster an (`-no-browser` unterdrückt das Öffnen, im `-dev`-Modus wird nie
geöffnet). Wird die EXE ein zweites Mal gestartet, öffnet sie nur die laufende Instanz im Browser.

Die Weboberfläche ist per `//go:embed` in die EXE eingebettet – die fertige `wbecModbus.exe`
ist somit eine **einzelne portable Datei**. Nur der `profiles/`-Ordner wird zur Laufzeit neben
der EXE angelegt/gelesen.

---

## Aufbau der Oberfläche

Oben steht die **Verbindungsleiste** (gilt für alle Modi): Wechselrichter-Typ (= Profil), IP-Adresse
mit Verlauf, Port / Unit-ID / Register-Typ (aus dem Profil übernommen, bei Bedarf anpassbar) und
„Verbindung testen“. Die IP und abweichende Einstellungen merkt sich der Browser pro Wechselrichter-Typ.

Darunter wählt man einen von drei Modi – passend zu den drei typischen Nutzergruppen:

- **Gerät prüfen** – der Wechselrichter wird von wbec unterstützt; man will sehen, ob die Werte ankommen.
  „Werte lesen“ zeigt alle Profil-Register als Karten mit physikalischem Wert und Einheit, eine ehrliche
  Zusammenfassung (alles / teilweise / nichts gelesen), Plausibilitätshinweise, Live-Lesen mit Verlauf
  und „Bericht kopieren“ (Markdown für Forum/GitHub).
- **Fehlersuche** – eine geführte Diagnose: Bridge → Netzwerk (IP/Port) → Modbus-Antwort (Unit-ID) →
  Register-Typ (FC03/FC04) → alle Profil-Register → Plausibilität über 15 s. Hält beim ersten Problem
  an, nennt die Ursache und bietet Abhilfe (Unit-ID-Suche, anderen Register-Typ übernehmen).
- **Register erforschen** – für neue Wechselrichter-Typen:
  1. **Bereich lesen** (in 125er-Blöcken; Blöcke mit nicht vorhandenen Registern werden automatisch
     eingegrenzt, damit alle lesbaren Register in der Tabelle landen),
  2. **bekannten Wert suchen** über alle Interpretationen und gängige Skalierungen
     (×1, ×0.1, ×0.01, ×0.001, ×10, ×100, ×1000) mit Toleranz – z.B. findet `230 ±5` auch `2312 × 0.1`,
  3. **beobachten** mit Verlaufsdiagramm je Register (CSV-Export),
  4. **Profil bauen**: Treffer „ins Profil“ übernehmen, benennen, als Profil speichern oder als JSON weitergeben.

  Die Registertabelle zeigt beim Überfahren alle Interpretationen (hex, binär, uint16, int16, ascii,
  uint32/int32 BE+LE, float BE+LE), per Klick eine Detailansicht; Filter „nur ≠ 0“ / „nur geändert“
  (Basis setzen oder Snapshot importieren), Export als CSV/JSON.

Unten läuft in allen Modi das **Protokoll**: jede Anfrage mit Register, Ergebnis und Dauer (Fehler in
Rot), zusätzlich in der Browser-Konsole.

Die Hilfe (**„? Hilfe"** oben rechts) enthält die vollständige Bedienanleitung; dieselbe Anleitung liegt
als [`HILFE.md`](HILFE.md) zum Weitergeben/Ausdrucken bei.

---

## Geräteprofile

Ein Profil bündelt die Verbindungsvorgaben (Port, Unit-ID, Function Code) und die bekannten Register
eines Wechselrichter-Typs. Profile werden von der Bridge als JSON-Dateien im Ordner `profiles/`
**gelesen und geschrieben**. Die mitgelieferten Profile sind in die EXE eingebettet und werden beim
Start nach `profiles/` kopiert, sofern dort noch keine gleichnamige Datei liegt (vorhandene Dateien
werden nie überschrieben). Beim Kopieren wird eine eventuell enthaltene IP entfernt – die IP gibt der
Nutzer in der Oberfläche ein, und der Browser merkt sie sich pro Profil.

Beispiel `profiles/01---solaredge-sunspec.json`:

```json
{
  "name": "01 - SolarEdge (SunSpec)",
  "ip": "",
  "port": 1502,
  "unit": 1,
  "function": 3,
  "registers": [
    { "address": 40083, "name": "AC Power", "type": "int16", "endian": "big", "scale": 1, "offset": 0, "unit": "W", "scaleRegister": 40084 }
  ]
}
```

Feldbedeutung eines Registers:

| Feld            | Werte                                           | Bedeutung                                                  |
|-----------------|-------------------------------------------------|------------------------------------------------------------|
| `address`       | 0–65535                                         | Startadresse                                               |
| `type`          | `uint16`, `int16`, `uint32`, `int32`, `float32` | 16-bit belegt 1, 32-bit belegt 2 Register                  |
| `endian`        | `big`, `little`                                 | Wortreihenfolge bei 32-bit-Typen                           |
| `scale`         | Zahl (z.B. `0.1`)                               | Faktor                                                     |
| `offset`        | Zahl                                            | wird nach der Skalierung addiert                           |
| `scaleRegister` | 0–65535 (optional)                              | SunSpec: int16-Register mit Skalierungsfaktor SF           |
| `unit`          | Text (z.B. `W`, `V`)                            | Anzeigeeinheit                                             |

`physikalisch = roh × scale × 10^SF + offset` (ohne `scaleRegister` ist SF = 0).

> Hinweis: Die in den mitgelieferten Profilen hinterlegten Adressen müssen gegen die Modbus-Doku des
> konkreten Geräts geprüft werden.

---

## HTTP API

Alle Fehler werden mit HTTP 200 und `"success": false` gemeldet; Clients werten das `success`-Flag aus.
Modbus-Fehler sind klassifiziert:

```json
{ "success": false, "error": "dial tcp 192.168.178.63:502: i/o timeout", "errorKind": "connect-timeout", "durationMs": 3001 }
```

| `errorKind`       | Bedeutung                                                         |
|-------------------|-------------------------------------------------------------------|
| `request`         | ungültige Anfrage (JSON, Function Code, Bereich)                  |
| `connect-timeout` | TCP-Verbindung kommt nicht zustande (IP, Gerät aus, anderes Netz) |
| `refused`         | Verbindung abgelehnt (Port geschlossen, Modbus TCP deaktiviert)   |
| `unreachable`     | sonstiger Verbindungsfehler (keine Route, ungültige Adresse)      |
| `timeout`         | verbunden, aber keine Modbus-Antwort (oft falsche Unit-ID)        |
| `closed`          | Gerät hat die Verbindung getrennt                                 |
| `exception`       | Modbus-Exception, Code in `exception` (z.B. 2 = illegal data address) |
| `protocol`        | ungültige/unpassende Antwort                                      |

### `GET /ping`
```json
{ "name": "wbecModbus", "version": "0.2.0" }
```

### `POST /modbus/read`
```json
{ "ip": "192.168.178.63", "port": 502, "unit": 247, "function": 3, "start": 35000, "count": 20 }
```
Antwort:
```json
{ "success": true, "durationMs": 41, "data": { "35000": 1234, "35001": 5678 } }
```

### `POST /modbus/batch`
Liest mehrere Bereiche über **eine** TCP-Verbindung (von der Oberfläche für Profile, Beobachten und
Bereichslesen verwendet). Max. 250 Bereiche, je 1–125 Register.
```json
{ "ip": "192.168.178.63", "port": 502, "unit": 247, "function": 3,
  "ranges": [ { "start": 35140, "count": 1 }, { "start": 35121, "count": 1 } ] }
```
Antwort – jeder Bereich hat ein eigenes Ergebnis; nach einem Timeout oder Verbindungsverlust werden
die restlichen Bereiche mit `"skipped": true` übersprungen. `success: false` (mit `errorKind`)
bedeutet, dass das Gerät gar nicht erreicht wurde.
```json
{ "success": true, "connectMs": 5, "results": [
  { "start": 35140, "count": 1, "success": true, "durationMs": 38, "data": { "35140": 2345 } },
  { "start": 35121, "count": 1, "success": false, "errorKind": "exception", "exception": 2,
    "error": "modbus: exception '2' (illegal data address), function '3'", "durationMs": 35 }
] }
```

### `POST /modbus/scan`
```json
{ "ip": "192.168.178.63", "port": 502, "unit": 247, "function": 3, "from": 35000, "to": 36000 }
```
Blockgröße max. 125 Register, 100 ms Pause zwischen Requests, max. Spannweite 10000.

### `GET /profiles`
```json
{ "success": true, "profiles": [ { "name": "14 - GoodWe ET", "ip": "", "registers": [ ... ] } ] }
```

### `POST /profiles/save`
Nimmt ein vollständiges Profil-Objekt entgegen und schreibt es nach `profiles/<slug>.json`.

### `POST /profiles/delete`
```json
{ "name": "14 - GoodWe ET" }
```

---

## Projektstruktur

```
mb/
├── main.go            # Flags, go:embed, Routing, Static-/Dev-Serving
├── types.go           # Request/Response-Strukturen, Fehlerklassen
├── modbus.go          # Verbindung, Registerlesen, Fehlerklassifizierung (goburrow/modbus)
├── handlers.go        # HTTP-Handler für read/batch/scan
├── profiles.go        # Profil-CRUD (Dateien), Auslieferprofile kopieren + Handler
├── go.mod / go.sum
├── profiles/          # Geräteprofile als JSON (eingebettet + zur Laufzeit gelesen/geschrieben)
└── web/               # in die EXE eingebettet
    ├── index.html
    ├── style.css
    └── js/
        ├── app.js         # Einstieg, Modus-Umschaltung, Hilfe
        ├── connection.js  # Verbindungsleiste, IP-Verlauf, gemerkte Einstellungen, Verbindungstest
        ├── check.js       # Modus „Gerät prüfen“
        ├── diagnose.js    # Modus „Fehlersuche“
        ├── explore.js     # Modus „Register erforschen“
        ├── editor.js      # Profil-Editor
        ├── reader.js      # Registerdefinitionen per Batch lesen und auswerten
        ├── interpret.js   # reine Wert-Interpretation (Datentypen, Skalierung, SunSpec-SF, Plausibilität)
        ├── chart.js       # Verlauf + SVG-Diagramme (ohne externe Bibliothek)
        ├── log.js         # Protokoll aller Anfragen (+ Browser-Konsole)
        ├── errors.js      # Fehlertexte zu den Fehlerklassen
        ├── report.js      # Bausteine für „Bericht kopieren“
        ├── api.js         # fetch-Wrapper
        ├── state.js       # gemeinsamer Zustand, Events, zyklisches Lesen, Statusanzeige
        ├── storage.js     # localStorage-Zugriff
        └── util.js        # DOM- und Formatierungshelfer
```

---

## Sicherheit

- Bind ausschließlich auf `127.0.0.1` – nicht aus dem Netzwerk erreichbar.
- Nur Lese-Function-Codes (FC03/FC04). **Kein** FC05/06/15/16 → keine Parameteränderung am Gerät.
- Profilnamen werden beim Speichern zu sicheren Dateinamen normalisiert (kein Path-Traversal).

---

## Entwicklungsentscheidungen

- **Go statt Python:** einzelne EXE, keine Runtime-Abhängigkeit, einfache Verteilung.
- **Browser statt Desktop-GUI:** einfache Erweiterbarkeit, keine GUI-Toolkits.
- **Dumme Bridge, Logik im Frontend:** die Bridge liefert nur Rohregister (`uint16`) und klassifizierte
  Transportfehler; sämtliche Interpretation, Suche, Diagnose und Darstellung passieren im Browser. Neue
  Anzeige-/Suchfunktionen brauchen daher meist nur Änderungen unter `web/`.
- **Keine externen Frontend-Bibliotheken:** auch die Diagramme sind selbst gezeichnetes SVG – die EXE
  funktioniert offline und bleibt eine einzelne Datei.
