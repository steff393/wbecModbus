// Request log: every Modbus request with result and duration, shown in the
// "Protokoll" panel and mirrored to the browser console.

import { $, esc, clock, show, copyText } from "./util.js";
import { describeError } from "./errors.js";

const MAX_ENTRIES = 300;
const COLLAPSED_ROWS = 6;

const entries = []; // oldest first
let expanded = false;

// entry: { time, fc, start?, count?, label?, ok, values?, info?, ms, note? }
export function logEntry(entry) {
	entries.push(entry);
	if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
	toConsole(entry);
	render();
}

function target(e) {
	if (e.label) return e.label;
	return e.count > 1 ? `${e.start}–${e.start + e.count - 1}` : String(e.start);
}

function result(e) {
	if (e.ok) return e.values ? `ok · ${e.values}` : "ok";
	return describeError(e.info);
}

export function lineText(e) {
	const note = e.note ? `  [${e.note}]` : "";
	return `${clock(e.time)}  FC0${e.fc}  ${target(e)}  →  ${result(e)}  (${e.ms} ms)${note}`;
}

function toConsole(e) {
	const msg = `[wbecModbus] ${lineText(e)}`;
	if (e.ok) console.info(msg);
	else if (e.info && e.info.errorKind === "exception") console.warn(msg, e.info);
	else console.error(msg, e.info);
}

// Plain-text lines of the newest `limit` entries (for reports).
export function logText(limit = 20) {
	return entries.slice(-limit).map(lineText).join("\n");
}

function rowHtml(e) {
	const cls = e.ok ? "" : e.info && e.info.errorKind === "exception" ? " log__row--warn" : " log__row--err";
	const note = e.note ? ` <span class="dim">· ${esc(e.note)}</span>` : "";
	return `<div class="log__row${cls}"><span class="dim">${clock(e.time)}</span><span>FC0${e.fc} ${esc(target(e))}</span><span class="log__res">${esc(result(e))}${note}</span><span class="dim log__ms">${e.ms} ms</span></div>`;
}

function render() {
	const errors = entries.filter((e) => !e.ok).length;
	const count = $("logCount");
	count.textContent = entries.length
		? `${entries.length} ${entries.length === 1 ? "Anfrage" : "Anfragen"}${errors ? ` · ${errors} Fehler` : ""}`
		: "noch keine Anfragen";
	count.classList.toggle("chip--err", errors > 0);

	const shown = (expanded ? entries : entries.slice(-COLLAPSED_ROWS)).slice().reverse();
	$("logList").innerHTML = shown.length
		? shown.map(rowHtml).join("")
		: `<div class="log__empty">Hier erscheint jede Anfrage an das Gerät – mit Ergebnis und Dauer.</div>`;
	$("logList").classList.toggle("log__list--expanded", expanded);

	const toggle = $("logToggle");
	show(toggle, entries.length > COLLAPSED_ROWS);
	toggle.textContent = expanded ? "weniger anzeigen" : `alle ${entries.length} anzeigen`;
}

export function initLog() {
	$("logToggle").addEventListener("click", () => {
		expanded = !expanded;
		render();
	});
	$("logClear").addEventListener("click", () => {
		entries.length = 0;
		render();
	});
	$("logCopy").addEventListener("click", async (e) => {
		const ok = await copyText(entries.map(lineText).join("\n"));
		e.target.textContent = ok ? "✓ kopiert" : "Kopieren nicht möglich";
		setTimeout(() => (e.target.textContent = "⧉ Kopieren"), 1500);
	});
	render();
}
