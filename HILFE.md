# ModbusBridge – Anleitung für Nutzer

**ModbusBridge** liest Werte aus einem Modbus-TCP-Gerät (z.B. Wechselrichter) aus.
Die Anwendung **liest nur** – am Gerät wird nichts verändert.

> Die gleiche Anleitung findest du jederzeit in der Oberfläche über den Knopf
> **„? Hilfe"** oben rechts.

---

## 1. Erste Schritte

1. **ModbusBridge.exe** starten (Doppelklick). Ein kleines Konsolenfenster bleibt offen – bitte offen lassen, solange du das Programm nutzt.
2. Browser öffnen und `http://127.0.0.1:8765` aufrufen.
3. Oben rechts zeigt der **Statuspunkt** den Zustand an: grün = bereit, gelb = arbeitet, rot = Fehler.

## 2. Verbindung einstellen

- **IP-Adresse:** Netzwerkadresse des Geräts (z.B. `192.168.178.63`).
- **Port:** meist `502`.
- **Unit ID:** Geräte-/Slave-Adresse laut Hersteller (z.B. `247`).
- **Function:** **Holding (FC03)** oder **Input (FC04)** – je nach Register laut Hersteller-Doku. Im Zweifel beides ausprobieren.

> **Tipp:** Am schnellsten geht es über ein **Profil** (links oben) – damit werden alle Verbindungsfelder automatisch gefüllt.

## 3. Register lesen

- Unter **Lesen** eine **Start**-Adresse und die **Anzahl** eingeben, dann **„Register lesen"**.
- Die Werte erscheinen rechts in der Tabelle **Register**.

## 4. Bereich scannen

- Unter **Scan** einen Bereich **Von/Bis** eingeben und **„Bereich scannen"** drücken.
- Ein **Fortschrittsbalken** zeigt den Stand; mit **„Abbrechen"** lässt sich der Scan jederzeit stoppen.

## 5. Die Registertabelle

- **Maus über eine Zeile:** Tooltip mit **allen Interpretationen** (hex, uint16/int16, uint32/int32, Kommazahl, …).
- **Zeile anklicken:** genau dieses Register wird **neu ausgelesen** (kurzes blaues Aufblinken).
- **Checkbox links:** Register zur **zyklischen Beobachtung** markieren.
- **Geänderte Werte** werden beim Aktualisieren **grün hervorgehoben**.

## 6. Zyklisch lesen (Live)

1. Register in der Tabelle per Checkbox markieren.
2. Links unter **„Zyklisch lesen"** ein **Intervall** (in Millisekunden) eingeben und starten – die Werte werden laufend aktualisiert. Erneut drücken zum Stoppen.

## 7. Filter

- **nur ≠ 0:** blendet Register mit dem Wert 0 aus.
- **nur geändert:** zeigt nur Register, die sich gegenüber einer **Basis** verändert haben. Zuerst **„Basis setzen"** drücken (oder einen Snapshot importieren), dann später erneut lesen.

## 8. Suche mit Toleranz

Einen **Wert** und eine **Toleranz** eingeben. Die Suche prüft alle Interpretationen und gängige Skalierungen.

> Beispiel: Suche nach `230` (Toleranz ±5) findet auch das Register `2328`,
> weil `2328 × 0,1 = 232,8` (also z.B. 232,8 V).

## 9. Export & Import

- **CSV ⭳:** aktuelle Tabelle als Tabellendatei (für Excel).
- **JSON ⭳:** vollständiger Schnappschuss der Werte.
- **Import ⭱:** ein zuvor gespeichertes JSON laden – es dient dann als **Vergleichsbasis** für den Filter „nur geändert".

## 10. Geräteprofile

- **Auswählen:** Profil im Dropdown wählen → Verbindungsdaten werden gefüllt.
- **Profil lesen:** liest alle hinterlegten Register und zeigt die **physikalischen Werte** mit Einheit (z.B. Watt, Volt).
- **Neu / Bearbeiten:** eigene Register anlegen. Je Register:
  - **Adresse** – Startadresse des Registers
  - **Name** – frei wählbare Bezeichnung
  - **Typ** – `uint16`, `int16`, `uint32`, `int32`, `float32`
  - **Endianness** – `big` oder `little` (Wortreihenfolge bei 32-bit-Werten)
  - **Skalierung** – der Rohwert wird damit multipliziert (`Wert × Skalierung`)
  - **Einheit** – z.B. `W`, `V`, `A`
  - **Speichern** legt das Profil ab, **Löschen** entfernt es.

---

## Problembehebung

| Problem | Mögliche Lösung |
|---|---|
| **„Bridge nicht erreichbar"** | Läuft die ModbusBridge.exe noch? Ist die Adresse `http://127.0.0.1:8765` korrekt? |
| **Fehler / Timeout beim Lesen** | IP, Port und Unit ID prüfen. Gerät im selben Netzwerk und eingeschaltet? Firewall? |
| **Nur Nullen / keine Werte** | Adressbereich stimmt evtl. nicht (Hersteller-Doku). Zwischen **Holding (FC03)** und **Input (FC04)** wechseln. |
| **Werte wirken „komisch"** | Per Tooltip die passende Interpretation (int16, uint32, Kommazahl, …) wählen; ggf. Skalierung im Profil setzen. |

## Sicherheit

Die Anwendung ist erreichbar **nur auf diesem PC** (`127.0.0.1`) und nutzt **ausschließlich Lesebefehle**.
Es können **keine** Geräteeinstellungen verändert werden.
