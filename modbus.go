package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/goburrow/modbus"
)

const (
	connectTimeout = 3 * time.Second
	scanBlockSize  = 125 // Modbus caps a single read at 125 registers.
	scanPause      = 100 * time.Millisecond
	maxScanRange   = 10000
	defaultPort    = 502
)

// createClient opens a fresh Modbus TCP connection. The caller must close the
// returned handler (defer handler.Close()).
func createClient(ip string, port int, unit byte) (modbus.Client, *modbus.TCPClientHandler, error) {
	if port == 0 {
		port = defaultPort
	}

	handler := modbus.NewTCPClientHandler(net.JoinHostPort(ip, strconv.Itoa(port)))
	handler.Timeout = connectTimeout
	handler.SlaveId = unit

	if err := handler.Connect(); err != nil {
		return nil, nil, err
	}

	return modbus.NewClient(handler), handler, nil
}

// readRegisters reads count 16-bit registers starting at start using the given
// function code (3 = holding, 4 = input) and decodes the big-endian words.
func readRegisters(client modbus.Client, function int, start, count uint16) ([]uint16, error) {
	var (
		raw []byte
		err error
	)

	switch function {
	case 3:
		raw, err = client.ReadHoldingRegisters(start, count)
	case 4:
		raw, err = client.ReadInputRegisters(start, count)
	default:
		return nil, fmt.Errorf("unsupported function code %d (only 3=holding, 4=input are supported)", function)
	}

	if err != nil {
		return nil, err
	}

	values := make([]uint16, len(raw)/2)
	for i := range values {
		values[i] = binary.BigEndian.Uint16(raw[i*2:])
	}

	return values, nil
}
