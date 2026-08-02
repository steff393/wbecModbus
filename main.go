package main

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/goburrow/modbus"
)

type ReadRequest struct {
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Unit     byte   `json:"unit"`
	Function int    `json:"function"`
	Start    uint16 `json:"start"`
	Count    uint16 `json:"count"`
}

type ReadResponse struct {
	Success  bool     `json:"success"`
	Error    string   `json:"error,omitempty"`
	Register []uint16 `json:"registers,omitempty"`
}

func jsonError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")

	json.NewEncoder(w).Encode(ReadResponse{
		Success: false,
		Error:   msg,
	})
}

func readHandler(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	var req ReadRequest

	err := json.NewDecoder(r.Body).Decode(&req)

	if err != nil {
		jsonError(w, err.Error())
		return
	}


	if req.Port == 0 {
		req.Port = 502
	}


	handler := modbus.NewTCPClientHandler(
		req.IP + ":" + strconv.Itoa(req.Port),
	)

	handler.Timeout = 3 * time.Second
	handler.SlaveId = req.Unit


	err = handler.Connect()

	if err != nil {
		jsonError(w, err.Error())
		return
	}

	defer handler.Close()


	client := modbus.NewClient(handler)


	var data []byte


	switch req.Function {

	case 3:
		data, err = client.ReadHoldingRegisters(
			req.Start,
			req.Count,
		)

	case 4:
		data, err = client.ReadInputRegisters(
			req.Start,
			req.Count,
		)

	default:
		jsonError(w, "unsupported function")
		return
	}


	if err != nil {
		jsonError(w, err.Error())
		return
	}


	registers := make([]uint16, len(data)/2)

	for i := range registers {
		registers[i] =
			binary.BigEndian.Uint16(
				data[i*2:],
			)
	}


	json.NewEncoder(w).Encode(ReadResponse{
		Success:  true,
		Register: registers,
	})
}


func pingHandler(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Content-Type", "application/json")

	json.NewEncoder(w).Encode(map[string]string{
		"name":    "ModbusBridge",
		"version": "0.1",
	})
}


func main() {


	http.HandleFunc(
		"/ping",
		pingHandler,
	)


	http.HandleFunc(
		"/modbus/read",
		readHandler,
	)


	fs := http.FileServer(
		http.Dir("./web"),
	)

	http.Handle(
		"/",
		fs,
	)


	log.Println(
		"ModbusBridge:",
		"http://127.0.0.1:8765",
	)


	err := http.ListenAndServe(
		"127.0.0.1:8765",
		nil,
	)

	if err != nil {
		log.Fatal(err)
	}
}