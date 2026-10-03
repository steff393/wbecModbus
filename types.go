package main

// Connection holds the device settings shared by every Modbus request.
type Connection struct {
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Unit     byte   `json:"unit"`
	Function int    `json:"function"`
}

// ReadRequest reads Count registers starting at Start.
type ReadRequest struct {
	Connection
	Start uint16 `json:"start"`
	Count uint16 `json:"count"`
}

// ScanRequest sweeps the inclusive range From..To in blocks.
type ScanRequest struct {
	Connection
	From uint32 `json:"from"`
	To   uint32 `json:"to"`
}

// RegisterRange is one contiguous block of registers.
type RegisterRange struct {
	Start uint16 `json:"start"`
	Count uint16 `json:"count"`
}

// BatchRequest reads several ranges over a single TCP connection.
type BatchRequest struct {
	Connection
	Ranges []RegisterRange `json:"ranges"`
}

// ErrorInfo describes a failure precisely enough for the UI to explain it.
// ErrorKind is one of:
//
//	request         invalid request (bad JSON, unsupported function code, range too large)
//	connect-timeout TCP connect timed out (wrong IP, device off, other network, firewall)
//	refused         TCP connection refused (port closed, Modbus TCP disabled)
//	unreachable     any other connect failure (no route, invalid address)
//	timeout         connected, but no Modbus response in time (often a wrong unit ID)
//	closed          the device closed or reset the connection
//	exception       Modbus exception response, see Exception
//	protocol        malformed or mismatching response
//	other           anything else
type ErrorInfo struct {
	Error     string `json:"error,omitempty"`
	ErrorKind string `json:"errorKind,omitempty"`
	Exception byte   `json:"exception,omitempty"` // Modbus exception code when ErrorKind == "exception"
}

// Response is the reply of /modbus/read and /modbus/scan. Errors are reported with
// Success=false and HTTP 200 — the frontend keys off the Success flag, not the status
// code. Data maps register address -> raw 16-bit value (JSON marshals the integer keys
// as strings).
type Response struct {
	Success bool `json:"success"`
	ErrorInfo
	DurationMs int64             `json:"durationMs"`
	Data       map[uint32]uint16 `json:"data,omitempty"`
}

// RangeResult is the outcome of one range of a batch. Skipped ranges were not sent
// because an earlier one timed out or lost the connection.
type RangeResult struct {
	RegisterRange
	Success bool `json:"success"`
	Skipped bool `json:"skipped,omitempty"`
	ErrorInfo
	DurationMs int64             `json:"durationMs"`
	Data       map[uint32]uint16 `json:"data,omitempty"`
}

// BatchResponse is the reply of /modbus/batch. Success=false means the device was not
// reached at all (ErrorInfo says why); otherwise each range has its own result.
type BatchResponse struct {
	Success bool `json:"success"`
	ErrorInfo
	ConnectMs int64         `json:"connectMs"`
	Results   []RangeResult `json:"results,omitempty"`
}
