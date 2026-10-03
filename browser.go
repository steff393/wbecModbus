package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

// openBrowser opens url in the default browser. Users double-click the EXE and
// would otherwise not know that the UI lives in the browser.
func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

// printBanner tells console users (German UI) where to find the interface.
func printBanner(url string, opened bool) {
	fmt.Println()
	fmt.Println("  ============================================================")
	fmt.Printf("   wbecModbus %s läuft.\n", version)
	fmt.Println()
	if opened {
		fmt.Println("   Die Oberfläche wurde im Browser geöffnet. Falls nicht,")
		fmt.Println("   bitte diese Adresse im Browser aufrufen:")
	} else {
		fmt.Println("   Bitte diese Adresse im Browser aufrufen:")
	}
	fmt.Println()
	fmt.Printf("      %s\n", url)
	fmt.Println()
	fmt.Println("   Dieses Fenster offen lassen, solange du wbecModbus nutzt.")
	fmt.Println("   Zum Beenden das Fenster schließen (oder Strg+C).")
	fmt.Println("  ============================================================")
	fmt.Println()
}
