package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"time"
)

//go:embed web
var webFS embed.FS

const (
	listenAddr = "127.0.0.1:8765"
	version    = "0.2.0"
)

func init() {
	// Windows resolves MIME types from the registry, where .js/.css are
	// frequently wrong. Force sane values so ES modules load reliably.
	_ = mime.AddExtensionType(".js", "text/javascript")
	_ = mime.AddExtensionType(".css", "text/css")
	_ = mime.AddExtensionType(".json", "application/json")
	_ = mime.AddExtensionType(".svg", "image/svg+xml") // favicon
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
	noBrowser := flag.Bool("no-browser", false, "don't open the UI in the browser on start")
	flag.Parse()

	http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, map[string]string{"name": "wbecModbus", "version": version})
	})

	if err := ensureProfilesDir(profilesDir, embeddedProfiles); err != nil {
		log.Fatal(err)
	}

	// Modbus (read-only)
	http.HandleFunc("/modbus/read", handleRead)
	http.HandleFunc("/modbus/batch", handleBatch)
	http.HandleFunc("/modbus/scan", handleScan)

	// Device profiles (stored as JSON files on disk)
	http.HandleFunc("/profiles", handleProfilesList)
	http.HandleFunc("/profiles/save", handleProfileSave)
	http.HandleFunc("/profiles/delete", handleProfileDelete)

	http.Handle("/", webRoot(*dev))

	url := "http://" + listenAddr
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		// Most likely started a second time: show the running instance instead of
		// a cryptic port error, and keep the window open long enough to read it.
		fmt.Printf("\n  wbecModbus läuft bereits (oder Port %s ist belegt).\n  Öffne %s im Browser …\n\n", listenAddr, url)
		_ = openBrowser(url)
		time.Sleep(10 * time.Second)
		os.Exit(1)
	}

	// In -dev mode the server is restarted often; don't open a new tab every time.
	opened := !*dev && !*noBrowser && openBrowser(url) == nil
	printBanner(url, opened)
	log.Printf("wbecModbus %s running on %s", version, url)
	log.Fatal(http.Serve(ln, nil))
}
