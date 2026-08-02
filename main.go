package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/goburrow/modbus"
)

type ReadRequest struct {
	IP string `json:"ip"`
	Port int `json:"port"`
	Unit byte `json:"unit"`
	Function int `json:"function"`
	Start uint16 `json:"start"`
	Count uint16 `json:"count"`
}

type ScanRequest struct {
	IP string `json:"ip"`
	Port int `json:"port"`
	Unit byte `json:"unit"`
	Function int `json:"function"`
	From uint32 `json:"from"`
	To uint32 `json:"to"`
}

type Response struct {
	Success bool `json:"success"`
	Error string `json:"error,omitempty"`
	Data map[uint32]uint16 `json:"data,omitempty"`
}

func sendJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

func createClient(ip string, port int, unit byte) (modbus.Client, *modbus.TCPClientHandler, error) {
	if port == 0 {
		port = 502
	}

	handler := modbus.NewTCPClientHandler(ip + ":" + strconv.Itoa(port))
	handler.Timeout = 3 * time.Second
	handler.SlaveId = unit

	if err := handler.Connect(); err != nil {
		return nil, nil, err
	}

	return modbus.NewClient(handler), handler, nil
}

func readRegisters(client modbus.Client, function int, start uint16, count uint16) ([]uint16, error) {
	var data []byte
	var err error

	switch function {
	case 3:
		data, err = client.ReadHoldingRegisters(start, count)
	case 4:
		data, err = client.ReadInputRegisters(start, count)
	default:
		return nil, fmt.Errorf("unsupported function: %d", function)
	}

	if err != nil {
		return nil, err
	}

	result := make([]uint16, len(data)/2)

	for i := range result {
		result[i] = binary.BigEndian.Uint16(data[i*2:])
	}

	return result, nil
}

func readHandler(w http.ResponseWriter, r *http.Request) {
	var req ReadRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, Response{Success: false, Error: err.Error()})
		return
	}

	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	if err != nil {
		sendJSON(w, Response{Success: false, Error: err.Error()})
		return
	}
	defer handler.Close()

	values, err := readRegisters(client, req.Function, req.Start, req.Count)
	if err != nil {
		sendJSON(w, Response{Success: false, Error: err.Error()})
		return
	}

	data := make(map[uint32]uint16)

	for i, value := range values {
		data[uint32(req.Start)+uint32(i)] = value
	}

	sendJSON(w, Response{
		Success: true,
		Data: data,
	})
}

func scanHandler(w http.ResponseWriter, r *http.Request) {
	var req ScanRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, Response{Success: false, Error: err.Error()})
		return
	}

	if req.To < req.From || req.To-req.From > 10000 {
		sendJSON(w, Response{
			Success: false,
			Error: "invalid scan range",
		})
		return
	}

	client, handler, err := createClient(req.IP, req.Port, req.Unit)
	if err != nil {
		sendJSON(w, Response{Success: false, Error: err.Error()})
		return
	}
	defer handler.Close()

	result := make(map[uint32]uint16)

	for address := req.From; address <= req.To; {
		count := uint32(125)

		if req.To-address+1 < count {
			count = req.To - address + 1
		}

		values, err := readRegisters(client, req.Function, uint16(address), uint16(count))
		if err != nil {
			sendJSON(w, Response{Success: false, Error: err.Error()})
			return
		}

		for i, value := range values {
			result[address+uint32(i)] = value
		}

		address += count
		time.Sleep(100 * time.Millisecond)
	}

	sendJSON(w, Response{
		Success: true,
		Data: result,
	})
}

func main() {
	http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, map[string]string{
			"name": "ModbusBridge",
			"version": "0.4",
		})
	})

	http.HandleFunc("/modbus/read", readHandler)
	http.HandleFunc("/modbus/scan", scanHandler)

	http.Handle("/", http.FileServer(http.Dir("./web")))

	log.Println("ModbusBridge running on http://127.0.0.1:8765")
	log.Fatal(http.ListenAndServe("127.0.0.1:8765", nil))
}