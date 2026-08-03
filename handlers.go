package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

func sendJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, err error) {
	sendJSON(w, Response{Success: false, Error: err.Error()})
}

// handleRead reads a single block of registers.
func handleRead(w http.ResponseWriter, r *http.Request) {
	var req ReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, err)
		return
	}

	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	if err != nil {
		fail(w, err)
		return
	}
	defer handler.Close()

	values, err := readRegisters(client, req.Function, req.Start, req.Count)
	if err != nil {
		fail(w, err)
		return
	}

	data := make(map[uint32]uint16, len(values))
	for i, v := range values {
		data[uint32(req.Start)+uint32(i)] = v
	}

	sendJSON(w, Response{Success: true, Data: data})
}

// handleScan sweeps a register range in 125-register blocks, pausing between
// requests so the device is not overwhelmed.
func handleScan(w http.ResponseWriter, r *http.Request) {
	var req ScanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, err)
		return
	}

	if req.To < req.From || req.To-req.From > maxScanRange {
		fail(w, errors.New("invalid scan range (max span is 10000 registers)"))
		return
	}

	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	if err != nil {
		fail(w, err)
		return
	}
	defer handler.Close()

	data := make(map[uint32]uint16)
	for address := req.From; address <= req.To; {
		count := uint32(scanBlockSize)
		if remaining := req.To - address + 1; remaining < count {
			count = remaining
		}

		values, err := readRegisters(client, req.Function, uint16(address), uint16(count))
		if err != nil {
			fail(w, err)
			return
		}

		for i, v := range values {
			data[address+uint32(i)] = v
		}

		address += count
		time.Sleep(scanPause)
	}

	sendJSON(w, Response{Success: true, Data: data})
}
