package main

// ReadRequest reads Count registers starting at Start.
type ReadRequest struct {
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Unit     byte   `json:"unit"`
	Function int    `json:"function"`
	Start    uint16 `json:"start"`
	Count    uint16 `json:"count"`
}

// ScanRequest sweeps the inclusive range From..To in blocks.
type ScanRequest struct {
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Unit     byte   `json:"unit"`
	Function int    `json:"function"`
	From     uint32 `json:"from"`
	To       uint32 `json:"to"`
}

// Response is the shared reply shape. Errors are reported with Success=false and
// HTTP 200 — the frontend keys off the Success flag, not the status code.
// Data maps register address -> raw 16-bit value (JSON marshals the integer keys
// as strings).
type Response struct {
	Success bool              `json:"success"`
	Error   string            `json:"error,omitempty"`
	Data    map[uint32]uint16 `json:"data,omitempty"`
}
