# ModbusBridge

## Übersicht

ModbusBridge ist eine lokale Hardware-Bridge, die einen Browser mit Modbus-TCP-Geräten verbindet.

Ziel ist es, Endkunden eine einfache Möglichkeit zu geben, ihren Wechselrichter oder andere Modbus-TCP-Geräte auszulesen, ohne zusätzliche Software installieren zu müssen.

Die Anwendung besteht aus:

1. einer kleinen lokalen Bridge (`ModbusBridge.exe`)
2. einer Browser-Oberfläche

Die Bridge stellt eine lokale HTTP-API bereit und kommuniziert mit dem Gerät über Modbus TCP.

---

# Architektur
Browser
|
| HTTP
|
127.0.0.1:8765
|
| Modbus TCP
|
Wechselrichter

Die Bridge lauscht ausschließlich auf: 127.0.0.1:8765  


und ist somit nicht aus dem Netzwerk erreichbar.

---

# Ziele

- einfache Diagnose von Wechselrichtern
- keine Installation beim Kunden
- keine direkte Browser-Modbus-Kommunikation notwendig
- portable EXE
- herstellerunabhängige Basis

---

# Unterstützte Funktionen

Aktuell:

- Modbus TCP
- Function Code 03:
  - Holding Register lesen
- Function Code 04:
  - Input Register lesen

Keine Schreibfunktionen.

Die Anwendung ist bewusst Read-Only aufgebaut.

---

# Projektstruktur
modbus-bridge/

├── main.go

├── go.mod
├── go.sum

└── web/  
	├── index.html
	├── style.css
	└── app.js


---

# Build

Voraussetzung:

- Go installiert

Abhängigkeit:
github.com/goburrow/modbus

Build:
go build

Ergebnis:
ModbusBridge.exe

---

# Start

EXE starten: ModbusBridge.exe

Danach Browser öffnen:http://127.0.0.1:8765


---

# HTTP API

## Status
GET /ping

Antwort:

```json
{
  "name":"ModbusBridge",
  "version":"0.3"
}

Register lesen
POST /modbus/read

Beispiel:

{
 "ip":"192.168.178.63",
 "port":502,
 "unit":247,
 "function":3,
 "start":35000,
 "count":20
}

Antwort:

{
 "success":true,
 "data":
 {
   "35000":1234,
   "35001":5678
 }
}
Scanner
POST /modbus/scan

Beispiel:

{
 "ip":"192.168.178.63",
 "port":502,
 "unit":247,
 "function":3,
 "from":30000,
 "to":31000
}

Eigenschaften:

maximale Blockgröße: 125 Register
Pause zwischen Requests: 100ms
nur Lesen
Sicherheitsaspekte

Die Anwendung verwendet ausschließlich Modbus-Leseoperationen.

Keine Unterstützung für:

FC05
FC06
FC15
FC16

Damit können keine Wechselrichterparameter verändert werden.

Aktuelle Oberfläche

Die Weboberfläche unterstützt:

IP-Adresse
Port
Unit ID
Holding/Input Register
Einzelne Registerbereiche lesen
Scanner
Interpretation:
uint16
int16
uint32 Big Endian
uint32 Little Endian
float Big Endian
float Little Endian
Geplante Funktionen
Register-Suche

Suche nach bekannten Werten:

Beispiel:

230

findet:

35110 uint16 230
35120 float 230.0
Geräteprofile

Unterstützung für Herstellerprofile:

Beispiel:

profiles/goodwe-et.json

mit:

Registername
Datentyp
Skalierung
Einheit
Weitere Ideen
Live-Monitor
CSV Export
JSON Export
Registervergleich
automatische Geräteerkennung
Modbus RTU über USB
Firmwarediagnose
Entwicklungsentscheidungen

Bewusst gewählt:

Go statt Python:
einzelne EXE
keine Runtime-Abhängigkeit
einfache Verteilung
Browser statt Desktop-GUI:
einfache Erweiterbarkeit
zentrale Aktualisierung
Bridge getrennt von UI:
Hardwarezugriff bleibt stabil
Oberfläche kann unabhängig erweitert werden

---

Damit haben wir jetzt einen guten "Kontextanker" für zukünftige Sessions oder andere KI-Unterstützung.

---

Als nächstes würde ich die **Suche** nicht einfach als Textsuche bauen, sondern etwas intelligenter:

## Register Value Search

Eingabe:


Suche:
230


Die Webseite prüft jedes Register als:

- uint16
- int16
- uint32 BE
- uint32 LE
- float32 BE
- float32 LE

und zeigt:

|Adresse|Typ|Wert|
|-|-|-|
|35110|uint16|230|
|35120|float32 BE|230.000|
|35200|int16|-230|

Dafür brauchen wir nur `app.js` erweitern – die Bridge bleibt unverändert. Das ist ein gutes Beispiel für die gewählte Architektur.