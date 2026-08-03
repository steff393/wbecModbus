# ModbusBridge

Eine lokale Hardware-Bridge, die einen Browser mit **Modbus-TCP-Geräten** verbindet – z.B.
um einen Wechselrichter auszulesen, ohne zusätzliche Software installieren zu müssen.

Die Anwendung besteht aus einer kleinen portablen `ModbusBridge.exe`, die

1. eine lokale HTTP-API bereitstellt,
2. die Weboberfläche ausliefert (in die EXE eingebettet) und
3. per Modbus TCP mit dem Gerät kommuniziert.

```
Browser  ──HTTP──►  127.0.0.1:8765 (ModbusBridge.exe)  ──Modbus TCP──►  Wechselrichter
```

Die Bridge lauscht **ausschließlich auf `127.0.0.1:8765`** und ist damit nicht aus dem
Netzwerk erreichbar. Die Anwendung ist bewusst **Read-Only** (nur FC03/FC04) – es können
keine Geräteparameter verändert werden.

---

## Build & Start

Voraussetzung: Go (siehe `go.mod`). Einzige Abhängigkeit: `github.com/goburrow/modbus`.

```sh
go build          # erzeugt ModbusBridge.exe (bzw. modbus-bridge unter Linux)
go run .          # bauen + starten in einem Schritt
go run . -dev     # Entwicklung: web/ wird von der Platte geladen (Datei ändern + Browser neu laden, kein Rebuild)
```

Nach dem Start im Browser öffnen: <http://127.0.0.1:8765>

Die Weboberfläche ist per `//go:embed` in die EXE eingebettet – die fertige `ModbusBridge.exe`
ist somit eine **einzelne portable Datei**. Nur der `profiles/`-Ordner wird zur Laufzeit neben
der EXE angelegt/gelesen.

---

## Funktionen der Oberfläche

- **Verbindung** – IP, Port, Unit ID, Function Code (FC03 Holding / FC04 Input).
- **Lesen** – einen Registerbereich (Start + Anzahl) lesen.
- **Scan** – einen größeren Bereich in 125er-Blöcken mit 100 ms Pause abtasten.
- **Registertabelle**
  - **Hover** über eine Zeile zeigt einen Tooltip mit *allen* Interpretationen
    (hex, binär, uint16, int16, ascii, uint32/int32 BE+LE, float BE+LE) – und, falls ein Profil
    aktiv ist, dem interpretierten physikalischen Wert.
  - **Klick** auf eine Zeile liest genau dieses Register neu und aktualisiert es (kurzes Highlight).
  - **Checkbox** markiert ein Register für das **zyklische Lesen**.
- **Zyklisch lesen (Watch)** – markierte Register werden im einstellbaren Intervall (ms) laufend
  aktualisiert; Start/Stopp per Knopfdruck.
- **Suche mit Toleranz** – sucht einen Wert über alle Interpretationen **und gängige Skalierungen**
  (×1, ×0.1, ×0.01, ×0.001, ×10, ×100, ×1000) innerhalb einer einstellbaren Toleranz.
  Beispiel: Suche nach `230` (Toleranz ±5) findet auch Register `2328`, weil `2328 × 0.1 = 232.8`
  (also z.B. 232,8 V).
- **Profile** – siehe unten.
- **Hilfe** – der Knopf **„? Hilfe"** oben rechts öffnet eine vollständige Bedienanleitung in der
  Oberfläche. Dieselbe Anleitung liegt als [`HILFE.md`](HILFE.md) zum Weitergeben/Ausdrucken bei.

---

## Geräteprofile

Ein Profil bündelt Verbindungsdaten und bekannte Register eines Geräts. Profile werden von der
Bridge als JSON-Dateien im Ordner `profiles/` **gelesen und geschrieben**.

- Profil im Dropdown wählen → Verbindungsfelder werden gefüllt.
- **Profil lesen** → alle definierten Register werden ausgelesen und als **physikalische Werte**
  angezeigt (Rohwert × Skalierung, mit Einheit).
- **Neu / Bearbeiten** → Editor zum Anlegen/Ändern von Registern (Adresse, Name, Typ, Endianness,
  Skalierung, Einheit). **Speichern** schreibt die JSON-Datei, **Löschen** entfernt sie.

Beispiel `profiles/goodwe-et.json`:

```json
{
  "name": "Goodwe ET",
  "ip": "192.168.178.63",
  "port": 502,
  "unit": 247,
  "function": 3,
  "registers": [
    { "address": 37113, "name": "Wirkleistung gesamt", "type": "int32", "endian": "big", "scale": 1, "unit": "W" }
  ]
}
```

Feldbedeutung eines Registers:

| Feld      | Werte                                             | Bedeutung                                  |
|-----------|---------------------------------------------------|--------------------------------------------|
| `address` | 0–65535                                            | Startadresse                               |
| `type`    | `uint16`, `int16`, `uint32`, `int32`, `float32`   | 16-bit belegt 1, 32-bit belegt 2 Register  |
| `endian`  | `big`, `little`                                    | Wortreihenfolge bei 32-bit-Typen           |
| `scale`   | Zahl (z.B. `0.1`)                                 | `physikalisch = roh × scale`               |
| `unit`    | Text (z.B. `W`, `V`)                              | Anzeigeeinheit                             |

> Hinweis: Die im mitgelieferten Goodwe-Profil hinterlegten Adressen sind Beispiele und müssen
> gegen die Modbus-Doku des konkreten Geräts geprüft werden.

---

## HTTP API

Alle Fehler werden mit HTTP 200 und `{"success": false, "error": "..."}` gemeldet; Clients werten
das `success`-Flag aus.

### `GET /ping`
```json
{ "name": "ModbusBridge", "version": "0.5" }
```

### `POST /modbus/read`
```json
{ "ip": "192.168.178.63", "port": 502, "unit": 247, "function": 3, "start": 35000, "count": 20 }
```
Antwort:
```json
{ "success": true, "data": { "35000": 1234, "35001": 5678 } }
```

### `POST /modbus/scan`
```json
{ "ip": "192.168.178.63", "port": 502, "unit": 247, "function": 3, "from": 30000, "to": 31000 }
```
Blockgröße max. 125 Register, 100 ms Pause zwischen Requests, max. Spannweite 10000.

### `GET /profiles`
```json
{ "success": true, "profiles": [ { "name": "Goodwe ET", "ip": "...", "registers": [ ... ] } ] }
```

### `POST /profiles/save`
Nimmt ein vollständiges Profil-Objekt entgegen und schreibt es nach `profiles/<slug>.json`.

### `POST /profiles/delete`
```json
{ "name": "Goodwe ET" }
```

---

## Projektstruktur

```
mb/
├── main.go            # Flags, go:embed, Routing, Static-/Dev-Serving
├── types.go           # Request/Response-Strukturen
├── modbus.go          # Verbindung + Registerlesen (goburrow/modbus)
├── handlers.go        # HTTP-Handler für read/scan
├── profiles.go        # Profil-CRUD (Dateien) + Handler
├── go.mod / go.sum
├── profiles/          # Geräteprofile als JSON (zur Laufzeit gelesen/geschrieben)
│   └── goodwe-et.json
└── web/               # in die EXE eingebettet
    ├── index.html
    ├── style.css
    └── js/
        ├── interpret.js  # reine Wert-Interpretation
        ├── api.js        # fetch-Wrapper
        └── app.js        # UI-Logik/State
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
- **Dumme Bridge, Logik im Frontend:** die Bridge liefert nur Rohregister (`uint16`), sämtliche
  Interpretation, Suche und Darstellung passieren im Browser. Neue Anzeige-/Suchfunktionen brauchen
  daher meist nur Änderungen unter `web/`.
