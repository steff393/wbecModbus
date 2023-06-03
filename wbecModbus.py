# Copyright (c) 2023 steff393
#!/usr/bin/env python3

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ConnectionException
import configparser
import sys

print("wbec Modbus-TCP-Kompatibilitätsprüfung")

config = configparser.ConfigParser()
config.read('cfg.ini')

cfg = config['Section 1']

for key in config['Section 1']:
	print(key.ljust(18) + ": " + config['Section 1'][key])
print("...bitte warten...")

try:
	client = ModbusTcpClient(cfg['cfgInverterIp'], port=cfg['cfgInverterPort'])
	client.connect()
	print("Registerwerte:")
	for key in config['Register']:
		response = client.read_holding_registers(int(key), int(config['Register'][key]), slave=int(cfg['cfgInverterAddr']), unit=0x01)

		# Check if reading was successful
		if response.isError():
			print(f"Register {int(key) + i}: Fehler: ", response)
		else:
			for i, register_value in enumerate(response.registers):
				print(f"Register {int(key) + i}: {register_value}")

	client.close()

except ConnectionException:
	print("Fehler: Server " + cfg['cfgInverterIp'] + ", Port " + cfg['cfgInverterPort'] + " nicht erreichbar")

