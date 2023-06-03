# Copyright (c) 2023 steff393
#!/usr/bin/env python3

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ConnectionException
import configparser
import sys

print("wbec Modbus-TCP-Kompatibilitätsprüfung")

config = configparser.ConfigParser(inline_comment_prefixes='#')
config.read('cfg.ini')

cfg = config['Configuration']
typ = config['Configuration']['Typ']

for key in cfg:
	print(key.ljust(18) + ": " + cfg[key])
print('Port'.ljust(18) + ": " + config[typ]['Port'])
print("...bitte warten...")

try:
	client = ModbusTcpClient(cfg['cfgInverterIp'], port=config[typ]['Port'])
	client.connect()
	print("Registerwerte:")
	for key in config[typ]:
		if not key.isdigit():
			continue
		# If key contains a register number, then read it
		response = client.read_holding_registers(int(key), int(config[typ][key]), slave=int(cfg['cfgInverterAddr']), unit=0x01)

		# Check if reading was successful
		if response.isError():
			print(f"Register {int(key)}: Fehler: ", response)
		else:
			for i, register_value in enumerate(response.registers):
				print(f"Register {int(key) + i}: {register_value}")

	client.close()

except ConnectionException:
	print("Fehler: Server " + cfg['cfgInverterIp'] + ", Port " + config[typ]['Port'] + " nicht erreichbar")

