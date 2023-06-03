**wbec** - WLAN-Anbindung der Heidelberg **W**all**B**ox **E**nergy **C**ontrol über ESP8266  

Mit wbecModbus lässt sich vorab prüfen, ob der eigene Wechselrichter von wbec ausgelesen werden kann.  
wbecModbus ist ein Tool für den PC.  

[wbec Homepage](https://steff393.github.io/wbec-site/)  

## Konfiguration
Die Einstellung der Parameter erfolgt über die Datei `cfg.ini`.  
Der Aufruf kann dann einfach per Doppelklick auf `wbecModbus.exe` erfolgen.    

Die wesentlichen Parameter (IP-Adresse und Typ) können alternativ auch über die Kommandozeile übergeben werden:  
```
wbecModbus.exe <IP-Adresse> <SolarEdge | Fronius | Kostal_mit_KSEM | Huawei | SMA | Victron | E3DC | Kostal_Plenticore>
```

## Beispiel
```
C:\Users\user>wbecModbus.exe 192.168.178.94 SMA

wbec Modbus-TCP-Kompatibilitätsprüfung
Übernehme IP und Typ aus Aufrufparametern...
IP   : 192.168.178.94
Typ  : SMA
Port : 502
Addr : 1
...bitte warten...
Registerwerte:
Register 30867: 1234
Register 30868: 56
Register 30865: 7890
Register 30866: 23
Server 192.168.178.94, Port 502 erfolgreich ausgelesen
```
