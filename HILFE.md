# wbecModbus – Anleitung für Nutzer

**wbecModbus** liest Werte aus einem Modbus-TCP-Gerät (z. B. Wechselrichter) aus.
Die Anwendung **liest nur** – am Gerät wird nichts verändert.

> Die gleiche Anleitung findest du jederzeit in der Oberfläche über den Knopf
> **„? Hilfe"** oben rechts.

---

## 1. Erste Schritte

1. **wbecModbus.exe** starten (Doppelklick). Ein kleines Konsolenfenster bleibt offen – bitte offen lassen, solange du das Programm nutzt.
2. Die Oberfläche öffnet sich automatisch im Browser. Falls nicht: Browser öffnen und `http://127.0.0.1:8765` aufrufen
   (die Adresse steht auch im Konsolenfenster).
3. Oben rechts zeigt der **Statuspunkt** den Zustand: grün = ok, gelb = Hinweis oder arbeitet, rot = Fehler.

## 2. Verbindung (oben, gilt für alle Modi)

- **Wechselrichter-Typ:** denselben Typ wählen wie in wbec. Port, Unit-ID und Register-Typ werden dann automatisch übernommen.
- **IP-Adresse:** Adresse des Wechselrichters. Sie wird pro Typ gemerkt; ein Klick ins Feld zeigt die zuletzt verwendeten Adressen.
- **anpassen:** Port, Unit-ID oder Register-Typ abweichend vom Profil einstellen. Auch das wird gemerkt; „auf Profilwerte zurücksetzen“ macht es rückgängig.
- **Verbindung testen:** prüft mit einer einzelnen Anfrage, ob das Gerät antwortet.

Darunter wählst du, was du tun möchtest:

| Modus | Wofür |
|---|---|
| **Gerät prüfen** | Dein Wechselrichter wird von wbec unterstützt – du willst sehen, ob die Werte ankommen. |
| **Fehlersuche** | wbec zeigt keine oder falsche Werte – du willst die Ursache finden. |
| **Register erforschen** | Dein Wechselrichter wird noch nicht unterstützt – du willst die Register finden. |

## 3. Modus „Gerät prüfen“

1. Wechselrichter-Typ wählen, 2. IP-Adresse eintragen, 3. **„Werte lesen“** klicken.

- Jeder Wert erscheint als Karte mit Einheit (z. B. Watt, Volt), Registeradresse und Rohwert.
- Die **Zusammenfassung** darüber sagt ehrlich, ob alle, nur ein Teil oder gar keine Werte gelesen wurden – mit Sprung in die Fehlersuche.
- **Live** liest regelmäßig (2–30 s); ein Klick auf eine Karte zeigt den **Verlauf** als Diagramm (Export als CSV).
- Unplausible Werte (z. B. 2312 V statt 231,2 V) werden markiert – meist stimmt dann Skalierung oder Datentyp nicht.
- **Bericht kopieren** erzeugt einen Text für Forum oder GitHub (Einstellungen, Werte, Fehler, letzte Anfragen).

## 4. Modus „Fehlersuche“

**„Diagnose starten“** prüft der Reihe nach:

1. wbecModbus läuft
2. Gerät im Netzwerk erreichbar (IP und Port)
3. Gerät antwortet per Modbus (Unit-ID)
4. Register-Typ passt (Holding oder Input)
5. alle Profil-Register lesbar
6. Werte plausibel und aktuell (15 s beobachten)

Beim ersten Problem hält die Diagnose an und sagt, was zu tun ist. Passende Knöpfe suchen z. B. die richtige
**Unit-ID** oder übernehmen den anderen **Register-Typ**. Auch hier gibt es **Bericht kopieren**.

Häufige Ursachen: Modbus TCP im Wechselrichter nicht aktiviert · wbec gleichzeitig verbunden (manche Geräte erlauben
nur einen Modbus-Client) · falsche Unit-ID · falscher Port (SolarEdge oft 1502) · anderes Netz (Gast-WLAN) · Gerät nachts im Standby.

## 5. Modus „Register erforschen“

1. **Bereich lesen:** Von/Bis eingeben. Große Bereiche werden in 125er-Blöcken gelesen; Register, die das Gerät nicht kennt, werden übersprungen.
2. **Bekannten Wert suchen:** einen aktuellen Wert (z. B. die PV-Leistung aus der Hersteller-App) eingeben. Gesucht wird in allen
   Datentypen und üblichen Skalierungen (×1, ×0,1, ×0,01, ×0,001, ×10, ×100, ×1000). Beispiel: 230 (±5) findet 2312, weil 2312 × 0,1 = 231,2.
3. **Beobachten und Verlauf:** ausgewählte Register zyklisch lesen; jeder Wert bekommt ein Diagramm. Das hilft bei der Deutung:
   Leistung schwankt mit Sonne und Last, Zählerstände steigen nur, Statuswerte springen.
4. **Profil bauen:** gefundene Register sammeln („ins Profil“), benennen und als Profil speichern – oder als JSON für die Umsetzung in wbec weitergeben.

Die **Registertabelle**: Maus darüber = alle Deutungen (hex, binär, uint16/int16, uint32/int32, Kommazahl …), Klick = Details mit
„beobachten“ und „ins Profil“, Haken = beobachten. Filter „nur ≠ 0“ und „nur geändert“ (vorher „Basis setzen“ oder einen Snapshot importieren).
Export als CSV (für Excel) oder JSON.

## 6. Protokoll

Jede Anfrage an das Gerät erscheint unten im **Protokoll** – mit Ergebnis und Dauer, Fehler in Rot. Zusätzlich stehen alle Anfragen
in der Konsole des Browsers (F12).

## 7. Profile und SunSpec

Ein Profil enthält Port, Unit-ID, Register-Typ und die Register (Adresse, Typ, Wortfolge, Skalierung, Einheit).
Physikalischer Wert = Rohwert × Skalierung × 10^SF + Offset. Bei SunSpec-Geräten (z. B. SolarEdge, Fronius, Kostal) steht der
Skalierungsfaktor SF in einem eigenen Register – das trägt man als **SF-Register** ein, dann wird er automatisch eingerechnet.

Die IP-Adresse steht nicht im Profil: wbecModbus merkt sie sich pro Wechselrichter-Typ in deinem Browser.
„LocalStorage löschen“ in der Hilfe setzt alle gemerkten Einstellungen zurück.

## Problembehebung

- **„wbecModbus nicht erreichbar“:** Läuft die wbecModbus.exe noch? Ist die Adresse `http://127.0.0.1:8765` korrekt?
- **Keine Verbindung oder keine Antwort:** den Modus **Fehlersuche** verwenden.
- **Werte wirken „komisch“:** Skalierung, Datentyp (16/32 Bit, mit/ohne Vorzeichen) oder Wortfolge stimmen nicht – in „Register erforschen“ die Details des Registers ansehen.

## Sicherheit

Die Anwendung ist **nur auf diesem PC** erreichbar (127.0.0.1) und nutzt **ausschließlich Lesebefehle**.
Geräteeinstellungen können **nicht** verändert werden.
