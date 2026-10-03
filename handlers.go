package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

func sendJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

// failRequest reports an invalid request (bad JSON or parameters).
func failRequest(w http.ResponseWriter, err error) {
	sendJSON(w, Response{ErrorInfo: ErrorInfo{Error: err.Error(), ErrorKind: "request"}})
}

// fail reports a non-Modbus error (e.g. profile storage).
func fail(w http.ResponseWriter, err error) {
	sendJSON(w, Response{ErrorInfo: ErrorInfo{Error: err.Error(), ErrorKind: "other"}})
}

// handleRead reads a single block of registers.
func handleRead(w http.ResponseWriter, r *http.Request) {
	var req ReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		failRequest(w, err)
		return
	}
	if err := checkFunction(req.Function); err != nil {
		failRequest(w, err)
		return
	}

	start := time.Now()
	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	if err != nil {
		sendJSON(w, Response{ErrorInfo: classifyConnect(err), DurationMs: msSince(start)})
		return
	}
	defer handler.Close()

	values, err := readRegisters(client, req.Function, req.Start, req.Count)
	if err != nil {
		sendJSON(w, Response{ErrorInfo: classifyRead(err), DurationMs: msSince(start)})
		return
	}

	sendJSON(w, Response{Success: true, DurationMs: msSince(start), Data: toData(req.Start, values)})
}

// handleBatch reads several ranges over one TCP connection, so a profile or a watch
// list costs one connect instead of one per register. Ranges fail individually (e.g.
// a missing register); after a timeout or a lost connection the rest is skipped.
func handleBatch(w http.ResponseWriter, r *http.Request) {
	var req BatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		failRequest(w, err)
		return
	}
	if err := checkFunction(req.Function); err != nil {
		failRequest(w, err)
		return
	}
	if len(req.Ranges) == 0 || len(req.Ranges) > maxBatchRanges {
		failRequest(w, fmt.Errorf("a batch needs 1..%d ranges", maxBatchRanges))
		return
	}
	for _, rg := range req.Ranges {
		if rg.Count == 0 || rg.Count > scanBlockSize || uint32(rg.Start)+uint32(rg.Count) > 65536 {
			failRequest(w, fmt.Errorf("invalid range start=%d count=%d (count 1..%d, end <= 65535)", rg.Start, rg.Count, scanBlockSize))
			return
		}
	}

	start := time.Now()
	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	connectMs := msSince(start)
	if err != nil {
		sendJSON(w, BatchResponse{ErrorInfo: classifyConnect(err), ConnectMs: connectMs})
		return
	}
	defer handler.Close()

	results := make([]RangeResult, 0, len(req.Ranges))
	lost := false
	for _, rg := range req.Ranges {
		res := RangeResult{RegisterRange: rg}
		if lost {
			res.Skipped = true
			results = append(results, res)
			continue
		}

		t := time.Now()
		values, err := readRegisters(client, req.Function, rg.Start, rg.Count)
		res.DurationMs = msSince(t)
		if err != nil {
			res.ErrorInfo = classifyRead(err)
			lost = connectionLost(res.ErrorInfo)
		} else {
			res.Success = true
			res.Data = toData(rg.Start, values)
		}
		results = append(results, res)
	}

	sendJSON(w, BatchResponse{Success: true, ConnectMs: connectMs, Results: results})
}

// handleScan sweeps a register range in 125-register blocks, pausing between
// requests so the device is not overwhelmed.
func handleScan(w http.ResponseWriter, r *http.Request) {
	var req ScanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		failRequest(w, err)
		return
	}
	if err := checkFunction(req.Function); err != nil {
		failRequest(w, err)
		return
	}
	if req.To < req.From || req.To-req.From > maxScanRange || req.To > 65535 {
		failRequest(w, errors.New("invalid scan range (max span is 10000 registers, end <= 65535)"))
		return
	}

	start := time.Now()
	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	if err != nil {
		sendJSON(w, Response{ErrorInfo: classifyConnect(err), DurationMs: msSince(start)})
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
			sendJSON(w, Response{ErrorInfo: classifyRead(err), DurationMs: msSince(start)})
			return
		}

		for i, v := range values {
			data[address+uint32(i)] = v
		}

		address += count
		time.Sleep(scanPause)
	}

	sendJSON(w, Response{Success: true, DurationMs: msSince(start), Data: data})
}
