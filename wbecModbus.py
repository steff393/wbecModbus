# Copyright (c) 2023 steff393
#!/usr/bin/env python3

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ConnectionException
import configparser

print("wbec Modbus-TCP-Kompatibilitätsprüfung")

config = configparser.ConfigParser()
config.read('cfg.ini')

cfgInverterIp        = config.get('Section 1', 'cfgInverterIp')
cfgInverterPort      = config.get('Section 1', 'cfgInverterPort')
cfgInverterAddr      = config.get('Section 1', 'cfgInverterAddr')
cfgInverterType      = config.get('Section 1', 'cfgInverterType')

cfgRegister          = config.get('Section 2', 'register')
cfgRegisterCount     = config.get('Section 2', 'registerCount')

print("cfgInverterIp:     " + cfgInverterIp)
print("cfgInverterPort:   " + cfgInverterPort)
print("cfgInverterAddr:   " + cfgInverterAddr)
print("cfgInverterType:   " + cfgInverterType)
print("register:          " + cfgRegister)
print("registerCount:     " + cfgRegisterCount)
print("...bitte warten...")

try:
	client = ModbusTcpClient(cfgInverterIp, port=cfgInverterPort)
	client.connect()

	response = client.read_holding_registers(int(cfgRegister), int(cfgRegisterCount), unit=0x01)

	# Check if reading was successful
	if response.isError():
		print("Fehler: ", response)
	else:
		print("Verbindung erfolgreich, Registerwerte:")
		for i, register_value in enumerate(response.registers):
			print(f"Register {int(cfgRegister) + i}: {register_value}")

	client.close()
	
except ConnectionException:
	print("Fehler: Server " + cfgInverterIp + ", Port " + cfgInverterPort + " nicht erreichbar")