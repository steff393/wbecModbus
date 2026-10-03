// German explanations for the bridge's error classification (see ErrorInfo in types.go).

const EXCEPTIONS = {
	1: "Illegal function – Register-Typ (Holding/Input) passt nicht",
	2: "Illegal data address – Register existiert nicht",
	3: "Illegal data value – Anfrage vom Gerät abgelehnt",
	4: "Slave device failure – Gerät meldet einen internen Fehler",
	5: "Acknowledge – Gerät bearbeitet die Anfrage noch",
	6: "Slave device busy – Gerät ist beschäftigt",
	8: "Memory parity error",
	10: "Gateway path unavailable – Gateway findet kein Ziel",
	11: "Gateway target failed to respond – Unit-ID prüfen",
};

export function exceptionText(code) {
	return EXCEPTIONS[code] || "unbekannter Fehlercode";
}

// One short sentence for a failed result {errorKind, exception, error}.
export function describeError(r) {
	if (!r) return "Unbekannter Fehler";
	switch (r.errorKind) {
		case "noip":
			return "Keine IP-Adresse eingetragen";
		case "bridge":
			return "wbecModbus nicht erreichbar – läuft die EXE noch?";
		case "request":
			return `Ungültige Anfrage (${r.error})`;
		case "connect-timeout":
			return "Keine Verbindung (Timeout)";
		case "refused":
			return "Verbindung abgelehnt (Port geschlossen?)";
		case "unreachable":
			return "Adresse nicht erreichbar";
		case "timeout":
			return "Keine Modbus-Antwort (Timeout)";
		case "closed":
			return "Gerät hat die Verbindung getrennt";
		case "exception":
			return `Modbus-Fehler ${r.exception}: ${exceptionText(r.exception)}`;
		case "protocol":
			return `Ungültige Antwort (${r.error})`;
		case "skipped":
			return "Nicht gelesen – das Gerät antwortete vorher nicht";
		default:
			return r.error || "Unbekannter Fehler";
	}
}

// Kinds where the device was never reached — every later request fails the same way.
export const CONNECTION_KINDS = new Set(["noip", "bridge", "request", "connect-timeout", "refused", "unreachable"]);
