package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"mime"
	"net/http"
)

//go:embed web
var webFS embed.FS

const (
	listenAddr = "127.0.0.1:8765"
	version    = "0.1.0"
)

func init() {
	// Windows resolves MIME types from the registry, where .js/.css are
	// frequently wrong. Force sane values so ES modules load reliably.
	_ = mime.AddExtensionType(".js", "text/javascript")
	_ = mime.AddExtensionType(".css", "text/css")
	_ = mime.AddExtensionType(".json", "application/json")
}

// webRoot serves the browser UI. In -dev mode the files are read from ./web on
// disk (edit + refresh, no rebuild); otherwise the copy embedded in the binary
// is used so the EXE stays a single portable file.
func webRoot(dev bool) http.Handler {
	if dev {
		log.Println("dev mode: serving ./web from disk")
		return http.FileServer(http.Dir("web"))
	}
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}
	return http.FileServer(http.FS(sub))
}

func main() {
	dev := flag.Bool("dev", false, "serve web assets from ./web on disk instead of the embedded copy")
	flag.Parse()

	http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, map[string]string{"name": "wbecModbus", "version": version})
	})

	if err := ensureProfilesDir(profilesDir, embeddedProfiles); err != nil {
		log.Fatal(err)
	}

	// Modbus (read-only)
	http.HandleFunc("/modbus/read", handleRead)
	http.HandleFunc("/modbus/scan", handleScan)

	// Device profiles (stored as JSON files on disk)
	http.HandleFunc("/profiles", handleProfilesList)
	http.HandleFunc("/profiles/save", handleProfileSave)
	http.HandleFunc("/profiles/delete", handleProfileDelete)

	http.Handle("/", webRoot(*dev))

	log.Printf("wbecModbus %s running on http://%s", version, listenAddr)
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
