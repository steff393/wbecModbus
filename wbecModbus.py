# Copyright (c) 2023 steff393
#!/usr/bin/env python3

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ConnectionException
import configparser
import sys

print("wbec Modbus-TCP-Kompatibilitätsprüfung")

config = configparser.ConfigParser(inline_comment_prefixes='#')
config.read('cfg.ini')

if len(sys.argv) == 3:
	print("Übernehme IP und Typ aus Aufrufparametern...")
	modbusIP  = sys.argv[1]
	modbusTyp = sys.argv[2]
	endEnter  = False
else:
	print("Übernehme IP und Typ aus cfg.ini...")
	modbusIP  = config['Configuration']['IP']
	modbusTyp = config['Configuration']['Typ']
	endEnter  = True

print('IP   : ' + modbusIP)
print('Typ  : ' + modbusTyp)
print('Port : ' + config[modbusTyp]['Port'])
print('Addr : ' + config[modbusTyp]['Addr'])
print("...bitte warten...")

try:
	client = ModbusTcpClient(modbusIP, port=config[modbusTyp]['Port'])
	client.connect()
	print("Registerwerte:")
	for key in config[modbusTyp]:
		if not key.isdigit():
			continue  # If key doesn't contains a register number, then skip it
		
		response = client.read_holding_registers(int(key), int(config[modbusTyp][key]), slave=int(config[modbusTyp]['Addr']), unit=0x01)

		# Check if reading was successful
		if response.isError():
			print(f"Register {int(key)}: Fehler: ", response)
		else:
			for i, register_value in enumerate(response.registers):
				print(f"Register {int(key) + i}: {register_value}")

	client.close()
	print("Server " + modbusIP + ", Port " + config[modbusTyp]['Port'] + " erfolgreich ausgelesen")

except ConnectionException:
	print("Fehler: Server " + modbusIP + ", Port " + config[modbusTyp]['Port'] + " nicht erreichbar")

if endEnter:
	input("<Enter> zum Beenden...")
