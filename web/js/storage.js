// Per-browser persistence (localStorage). Every access is guarded: storage can be
// unavailable (private window, blocked site data) and the app must still work.

const PREFIX = "wbecModbus.";

export function load(key, fallback) {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		return raw === null ? fallback : JSON.parse(raw);
	} catch {
		return fallback;
	}
}

export function save(key, value) {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// storage full or blocked — the setting just won't survive a reload
	}
}

// Removes everything this app stored (IP history, connections, watch list, draft …).
export function clearAll() {
	try {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(PREFIX)) localStorage.removeItem(key);
		}
	} catch {
		// nothing to clear
	}
}
