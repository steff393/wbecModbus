// Small DOM and formatting helpers shared by all UI modules.

export const $ = (id) => document.getElementById(id);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function show(el, on) {
	el.classList.toggle("hidden", !on);
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escape text for innerHTML — profile and register names are user input.
export function esc(value) {
	return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Physical values in German notation ("2.345", "231,2").
export function fmtNum(n, maxFrac = 3) {
	if (n === null || n === undefined || Number.isNaN(n)) return "—";
	if (!Number.isFinite(n)) return String(n);
	return n.toLocaleString("de-DE", { maximumFractionDigits: maxFrac });
}

// Accepts "2,5" as well as "2.5"; empty input yields NaN.
export function parseNum(text) {
	const t = String(text ?? "").trim().replace(",", ".");
	return t === "" ? NaN : Number(t);
}

// Integer in [min, max] or null.
export function parseIntIn(text, min, max) {
	const n = parseNum(text);
	return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function clock(t = Date.now()) {
	return new Date(t).toLocaleTimeString("de-DE");
}

export function dateTime(t = Date.now()) {
	return new Date(t).toLocaleString("de-DE");
}

export function stamp() {
	return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

export const FC_LABELS = { 3: "Holding-Register (FC03)", 4: "Input-Register (FC04)" };

export function fcLabel(fc) {
	return FC_LABELS[fc] || `FC${fc}`;
}

export function download(filename, text, mime) {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

// CSV for a German Excel: ";" separated, decimal comma.
export function toCsv(rows) {
	const cell = (v) => {
		if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
		const s = String(v ?? "");
		return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

export async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Fallback for browsers that block the async clipboard API.
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try {
			ok = document.execCommand("copy");
		} catch {
			ok = false;
		}
		ta.remove();
		return ok;
	}
}
