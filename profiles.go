package main

import (
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

//go:embed profiles/*.json
var embeddedProfiles embed.FS

// profilesDir holds one JSON file per device profile, next to the executable.
const profilesDir = "profiles"

// RegisterDef describes how one (or two, for 32-bit types) raw register(s) map
// to a physical value.
type RegisterDef struct {
	Address uint16  `json:"address"`
	Name    string  `json:"name"`
	Type    string  `json:"type"`   // uint16 | int16 | uint32 | int32 | float32
	Endian  string  `json:"endian"` // big | little (word order for 32-bit types)
	Scale   float64 `json:"scale"`  // physical = raw * scale * 10^SF + offset
	Offset  float64 `json:"offset"` // physical = raw * scale * 10^SF + offset
	Unit    string  `json:"unit"`
	// ScaleRegister optionally names an int16 register holding a SunSpec scale factor
	// SF (physical = raw * scale * 10^SF + offset). Nil means SF = 0.
	ScaleRegister *uint16 `json:"scaleRegister,omitempty"`
}

// Profile bundles the connection settings and known registers of one device.
type Profile struct {
	Name      string        `json:"name"`
	IP        string        `json:"ip"`
	Port      int           `json:"port"`
	Unit      byte          `json:"unit"`
	Function  int           `json:"function"`
	Registers []RegisterDef `json:"registers"`
}

var slugCleaner = regexp.MustCompile(`[^a-z0-9_-]+`)

func ensureProfilesDir(baseDir string, profileFS fs.FS) error {
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return err
	}

	entries, err := fs.ReadDir(profileFS, "profiles")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		sourcePath := path.Join("profiles", entry.Name())
		targetPath := filepath.Join(baseDir, entry.Name())
		if _, statErr := os.Stat(targetPath); statErr == nil {
			continue
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return statErr
		}

		data, err := fs.ReadFile(profileFS, sourcePath)
		if err != nil {
			return err
		}
		if err := os.WriteFile(targetPath, withoutIP(data), 0o644); err != nil {
			return err
		}
	}

	return nil
}

// withoutIP blanks the device IP of a shipped profile: the delivered state must not
// carry anyone's device address. The UI remembers the IP a user enters per profile
// in the browser instead. Files that don't parse are copied unchanged.
func withoutIP(data []byte) []byte {
	var p Profile
	if err := json.Unmarshal(data, &p); err != nil || p.IP == "" {
		return data
	}
	p.IP = ""
	clean, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return data
	}
	return clean
}

// profileFileName turns a display name into a safe file name, preventing path
// traversal from user-supplied names.
func profileFileName(name string) (string, error) {
	slug := slugCleaner.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "", errors.New("invalid profile name")
	}
	return slug + ".json", nil
}

func listProfiles() ([]Profile, error) {
	entries, err := os.ReadDir(profilesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Profile{}, nil
		}
		return nil, err
	}

	profiles := make([]Profile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(profilesDir, e.Name()))
		if err != nil {
			continue // skip unreadable files rather than failing the whole list
		}
		var p Profile
		if err := json.Unmarshal(data, &p); err != nil {
			continue // skip malformed files
		}
		profiles = append(profiles, p)
	}

	sort.Slice(profiles, func(i, j int) bool { return profiles[i].Name < profiles[j].Name })
	return profiles, nil
}

func saveProfile(p Profile) error {
	fileName, err := profileFileName(p.Name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(profilesDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(profilesDir, fileName), data, 0o644)
}

func deleteProfile(name string) error {
	fileName, err := profileFileName(name)
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(profilesDir, fileName)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func handleProfilesList(w http.ResponseWriter, r *http.Request) {
	profiles, err := listProfiles()
	if err != nil {
		fail(w, err)
		return
	}
	sendJSON(w, map[string]any{"success": true, "profiles": profiles})
}

func handleProfileSave(w http.ResponseWriter, r *http.Request) {
	var p Profile
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		fail(w, err)
		return
	}
	if strings.TrimSpace(p.Name) == "" {
		fail(w, errors.New("profile name is required"))
		return
	}
	if err := saveProfile(p); err != nil {
		fail(w, err)
		return
	}
	sendJSON(w, Response{Success: true})
}

func handleProfileDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, err)
		return
	}
	if err := deleteProfile(body.Name); err != nil {
		fail(w, err)
		return
	}
	sendJSON(w, Response{Success: true})
}
