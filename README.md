**wbec** - WLAN-Anbindung der Heidelberg **W**all**B**ox **E**nergy **C**ontrol über ESP8266  

Mit wbecModbus lässt sich vorab prüfen, ob der eigene Wechselrichter von wbec ausgelesen werden kann.  
wbecModbus ist ein Tool für den PC.  

[wbec Homepage](https://steff393.github.io/wbec-site/)  

## Konfiguration
Die Einstellung der Parameter erfolgt über die Datei cfg.ini  


## Beispiel

```
C:\Users\user>wbecModbus.exe

wbec Modbus-TCP-Kompatibilitätsprüfung
cfgInverterIp:     192.168.178.94
cfgInverterPort:   502
cfgInverterAddr:   1
cfgInverterType:   1
register:          30810
registerCount:     4
...bitte warten...
Verbindung erfolgreich, Registerwerte:
Register 30810: 30810
Register 30811: 30811
Register 30812: 30812
Register 30813: 30813
```
