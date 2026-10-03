// Markdown building blocks for "Bericht kopieren" (forum posts, GitHub issues).

import { app } from "./state.js";
import { dateTime, fcLabel } from "./util.js";
import { logText } from "./log.js";

export function reportHeader(mode) {
	const c = app.conn;
	return [
		`### wbecModbus-Bericht: ${mode}`,
		"",
		`- Zeit: ${dateTime()}`,
		`- wbecModbus: v${app.version || "?"}`,
		`- Wechselrichter-Typ: ${app.profile ? app.profile.name : "unbekannt (ohne Profil)"}`,
		`- Verbindung: ${c.ip || "(keine IP)"}:${c.port}, Unit-ID ${c.unit}, ${fcLabel(c.function)}`,
		"",
	].join("\n");
}

export function reportLog(limit = 20) {
	const text = logText(limit);
	if (!text) return "";
	return ["", "<details><summary>Protokoll (letzte Anfragen)</summary>", "", "```", text, "```", "</details>"].join("\n");
}

// Escape a value for a Markdown table cell.
export function mdCell(value) {
	return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
