package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/goburrow/modbus"
)

const (
	connectTimeout = 3 * time.Second
	scanBlockSize  = 125 // Modbus caps a single read at 125 registers.
	scanPause      = 100 * time.Millisecond
	maxScanRange   = 10000
	maxBatchRanges = 250
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

// checkFunction rejects everything but the two read-only function codes.
func checkFunction(function int) error {
	if function != 3 && function != 4 {
		return fmt.Errorf("unsupported function code %d (only 3=holding, 4=input are supported)", function)
	}
	return nil
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
		return nil, checkFunction(function)
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

// toData maps consecutive values to their register addresses.
func toData(start uint16, values []uint16) map[uint32]uint16 {
	data := make(map[uint32]uint16, len(values))
	for i, v := range values {
		data[uint32(start)+uint32(i)] = v
	}
	return data
}

func msSince(t time.Time) int64 {
	return time.Since(t).Milliseconds()
}

// Windows socket error numbers (the syscall package names them only on Windows).
const (
	wsaConnReset   = 10054
	wsaConnRefused = 10061
)

func hasErrno(err error, codes ...syscall.Errno) bool {
	var errno syscall.Errno
	if !errors.As(err, &errno) {
		return false
	}
	for _, c := range codes {
		if errno == c {
			return true
		}
	}
	return false
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// classifyConnect explains why the TCP connection could not be opened.
func classifyConnect(err error) ErrorInfo {
	kind := "unreachable"
	switch {
	case isTimeout(err):
		kind = "connect-timeout"
	case hasErrno(err, syscall.ECONNREFUSED, wsaConnRefused) || strings.Contains(strings.ToLower(err.Error()), "refused"):
		kind = "refused"
	}
	return ErrorInfo{Error: err.Error(), ErrorKind: kind}
}

// classifyRead explains why a request on an open connection failed.
func classifyRead(err error) ErrorInfo {
	var mbErr *modbus.ModbusError
	kind := "other"
	switch {
	case errors.As(err, &mbErr):
		return ErrorInfo{Error: err.Error(), ErrorKind: "exception", Exception: mbErr.ExceptionCode}
	case isTimeout(err):
		kind = "timeout"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF), hasErrno(err, syscall.ECONNRESET, wsaConnReset):
		kind = "closed"
	case strings.HasPrefix(err.Error(), "modbus:"):
		kind = "protocol"
	}
	return ErrorInfo{Error: err.Error(), ErrorKind: kind}
}

// connectionLost reports whether later requests on the same connection are pointless:
// after a timeout a late reply could be mistaken for the next answer, and a closed
// connection cannot be used at all.
func connectionLost(info ErrorInfo) bool {
	return info.ErrorKind == "timeout" || info.ErrorKind == "closed"
}
