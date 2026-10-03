// Mode "Gerät prüfen": read the registers of a known inverter type and show them as
// physical values — the quick check whether wbec can read this device.

import { $, esc, fmtNum, show, copyText, download, stamp, toCsv, clock } from "./util.js";
import { app, on, setStatus, startPoller, stopPoller, pollerOwner } from "./state.js";
import { readDefs } from "./reader.js";
import { describeError } from "./errors.js";
import { createHistory, sparkline, renderChart } from "./chart.js";
import { typeLabel, hasScaleRegister, fmtFloat } from "./interpret.js";
import { reportHeader, reportLog, mdCell } from "./report.js";

const history = createHistory(720); // key: index of the register in the profile
let last = null; // result of the last readDefs() for the active profile
let reading = false;
let selected = null; // index of the register whose chart is open

export function initCheck({ gotoMode }) {
	$("btnCheckRead").addEventListener("click", () => readOnce(false));
	$("checkLive").addEventListener("change", (e) => (e.target.checked ? startLive() : stopPoller("check")));
	$("checkInterval").addEventListener("change", () => {
		if (pollerOwner() === "check") startLive();
	});
	$("btnCheckReport").addEventListener("click", copyReport);
	$("checkGotoExplore").addEventListener("click", () => gotoMode("explore"));
	$("checkBanner").addEventListener("click", (e) => {
		const target = e.target.closest("[data-goto]");
		if (target) gotoMode(target.dataset.goto);
	});
	$("checkCards").addEventListener("click", (e) => {
		const card = e.target.closest("[data-def]");
		if (!card) return;
		selected = Number(card.dataset.def);
		renderCards();
		renderDetail();
		$("checkDetail").scrollIntoView({ block: "nearest", behavior: "smooth" });
	});
	$("btnCheckDetailClose").addEventListener("click", () => {
		selected = null;
		renderCards();
		renderDetail();
	});
	$("btnCheckDetailCsv").addEventListener("click", exportDetailCsv);
	window.addEventListener("resize", () => selected !== null && renderDetail());

	on("profile", () => {
		stopPoller("check");
		resetResults();
	});
	on("conn", resetResults); // old values belong to other settings
	render();
}

function resetResults() {
	last = null;
	selected = null;
	history.clear();
	render();
}

function defName(def) {
	return def.name || `Register ${def.address}`;
}

// --- Reading ----------------------------------------------------------------

function startLive() {
	if (!app.profile) {
		$("checkLive").checked = false;
		return setStatus("err", "Bitte zuerst den Wechselrichter-Typ wählen");
	}
	const ms = Number($("checkInterval").value) * 1000;
	startPoller("check", ms, () => readOnce(true), () => ($("checkLive").checked = false));
	$("checkLive").checked = true;
}

async function readOnce(live) {
	const p = app.profile;
	if (!p) return setStatus("err", "Bitte zuerst oben den Wechselrichter-Typ wählen");
	if (!p.registers.length) return setStatus("err", "Dieses Profil enthält keine Register");
	if (reading) return;

	reading = true;
	if (!live) setStatus("busy", `Lese ${p.registers.length} Werte …`);
	$("btnCheckRead").disabled = true;
	try {
		const res = await readDefs(app.conn, p.registers, { log: live ? "errors" : "all", note: "Gerät prüfen" });
		if (app.profile !== p) return; // the type was switched while waiting
		last = res;
		res.items.forEach((it, i) => history.push(String(i), res.time, it.status === "ok" ? it.value : null));
		render();
		const s = summarize(res);
		setStatus(s.kind, live ? `Live · ${clock(res.time)} · ${s.short}` : s.short);
	} finally {
		reading = false;
		$("btnCheckRead").disabled = false;
	}
}

// Overall verdict: {kind: ok|warn|err, text, short, goto}.
function summarize(res) {
	const n = res.items.length;
	const okItems = res.items.filter((it) => it.status === "ok");
	const warned = okItems.filter((it) => it.warning).length;

	if (res.connError && res.connError.errorKind === "noip") {
		return { kind: "warn", text: "Trage oben die IP-Adresse des Wechselrichters ein.", short: "IP-Adresse fehlt", goto: false };
	}
	if (res.connError) {
		return { kind: "err", text: `Keine Verbindung: ${describeError(res.connError)}.`, short: describeError(res.connError), goto: true };
	}
	if (okItems.length === 0) {
		const e = describeError(res.items[0].error);
		return { kind: "err", text: `Kein Wert gelesen: ${e}.`, short: "Kein Wert gelesen", goto: true };
	}
	if (okItems.length < n) {
		const bad = res.items.filter((it) => it.status !== "ok").map((it) => defName(it.def));
		return {
			kind: "warn",
			text: `${okItems.length} von ${n} Werten gelesen. Fehler bei: ${bad.join(", ")} – Details in den Karten und im Protokoll.`,
			short: `${okItems.length} von ${n} Werten gelesen`,
			goto: true,
		};
	}
	if (warned) {
		return {
			kind: "warn",
			text: `Alle ${n} Werte gelesen, aber ${warned} ${warned === 1 ? "wirkt" : "wirken"} unplausibel – Hinweise in den Karten.`,
			short: `${n} Werte gelesen, ${warned} unplausibel`,
			goto: false,
		};
	}
	return {
		kind: "ok",
		text: `Alle ${n} Werte gelesen. Mit diesen Einstellungen sollte wbec den Wechselrichter auslesen können – vergleiche die Werte am besten mit der Hersteller-App.`,
		short: `Alle ${n} Werte gelesen`,
		goto: false,
	};
}

// --- Rendering --------------------------------------------------------------

function render() {
	renderSteps();
	const p = app.profile;
	show($("checkNoProfile"), !p);
	show($("checkMain"), !!p);
	if (!p) {
		show($("checkDetail"), false);
		return;
	}
	renderBanner();
	renderCards();
	renderDetail();
}

function renderSteps() {
	const steps = [
		[!!app.profile, "1 Wechselrichter-Typ wählen", "1 Typ gewählt"],
		[!!app.conn.ip, "2 IP-Adresse eintragen", "2 IP eingetragen"],
		[!!(last && last.ok > 0), "3 Werte lesen", "3 Werte gelesen"],
	];
	const current = steps.findIndex(([done]) => !done);
	$("checkSteps").innerHTML = steps
		.map(([done, todo, doneText], i) => {
			const cls = done ? "step--done" : i === current ? "step--current" : "";
			return `<span class="step ${cls}">${done ? "✓ " + doneText : todo}</span>`;
		})
		.join(`<span class="step__sep">›</span>`);
}

function renderBanner() {
	const el = $("checkBanner");
	if (!last) {
		show(el, false);
		return;
	}
	const s = summarize(last);
	const icon = { ok: "✓", warn: "⚠", err: "✗" }[s.kind];
	el.className = `banner banner--${s.kind}`;
	el.innerHTML =
		`<span class="banner__icon">${icon}</span><span class="banner__text">${esc(s.text)}</span>` +
		(s.goto ? `<button class="btn btn--sm" data-goto="diagnose">Zur Fehlersuche</button>` : "");
}

function fmtRaw(raw) {
	return Number.isInteger(raw) ? String(raw) : fmtFloat(raw);
}

function metaText(def, it) {
	let meta = `${def.address} · ${typeLabel(def)}`;
	if (Number(def.scale) !== 1 && def.scale !== undefined && def.scale !== "") meta += ` ×${fmtNum(Number(def.scale), 6)}`;
	if (hasScaleRegister(def)) meta += ` · SF ${it && it.sf !== null ? it.sf : "?"} (Reg. ${def.scaleRegister})`;
	if (it && it.raw !== null && it.raw !== undefined) meta += ` · roh ${fmtRaw(it.raw)}`;
	return meta;
}

function renderCards() {
	const p = app.profile;
	if (!p) return;
	const items = last ? last.items : null;
	$("checkCards").innerHTML = p.registers
		.map((def, i) => {
			const it = items ? items[i] : null;
			const status = it ? it.status : "pending";
			let value = "—";
			let note = "";
			let noteKind = "";
			let cls = status === "ok" ? "ok" : status === "error" ? "err" : "pending";
			if (status === "ok") {
				value = `${fmtNum(it.value)}<span class="vcard__unit">${esc(def.unit || "")}</span>`;
				if (it.warning) {
					note = it.warning;
					noteKind = "warn";
					cls = "warn";
				}
			} else if (status === "error") {
				value = "Fehler";
				note = (it.sfFailed ? `Skalierungsregister ${def.scaleRegister}: ` : "") + describeError(it.error);
				noteKind = "err";
			} else if (status === "skipped") {
				note = "Nicht gelesen – das Gerät antwortete vorher nicht";
				noteKind = "err";
			}
			const icon = { ok: "✓", warn: "⚠", err: "✗", pending: "○" }[cls];
			return `
<div class="vcard vcard--${cls}${selected === i ? " vcard--sel" : ""}" data-def="${i}" title="Klicken für den Verlauf">
	<div class="vcard__head"><span class="vcard__name">${esc(defName(def))}</span><span class="vcard__icon">${icon}</span></div>
	<div class="vcard__value">${value}</div>
	<svg class="vcard__spark"></svg>
	<div class="vcard__meta mono">${esc(metaText(def, it))}</div>
	${note ? `<div class="vcard__note vcard__note--${noteKind}">${esc(note)}</div>` : ""}
</div>`;
		})
		.join("");
	$("checkCards").querySelectorAll("[data-def]").forEach((card) => {
		sparkline(card.querySelector("svg"), history.get(card.dataset.def));
	});
}

function renderDetail() {
	const p = app.profile;
	const def = p && selected !== null ? p.registers[selected] : null;
	show($("checkDetail"), !!def);
	if (!def) return;
	$("checkDetailTitle").textContent = `Verlauf: ${defName(def)}`;
	const points = history.get(String(selected));
	renderChart($("checkChart"), points, { unit: def.unit || "" });
	show($("checkDetailHint"), pollerOwner() !== "check" && points.length < 3);
}

function exportDetailCsv() {
	const def = app.profile && selected !== null ? app.profile.registers[selected] : null;
	if (!def) return;
	const points = history.get(String(selected));
	if (!points.length) return setStatus("err", "Noch kein Verlauf vorhanden");
	const rows = [["Zeit", `${defName(def)}${def.unit ? ` [${def.unit}]` : ""}`]];
	for (const pt of points) rows.push([new Date(pt.t).toLocaleString("de-DE"), pt.v]);
	download(`verlauf-${stamp()}.csv`, toCsv(rows), "text/csv");
}

// --- Report -----------------------------------------------------------------

async function copyReport() {
	const lines = [reportHeader("Gerät prüfen")];
	if (!last || !app.profile) {
		lines.push("_Noch keine Werte gelesen._");
	} else {
		lines.push(`**Ergebnis:** ${summarize(last).text}`, "", "| Wert | Ergebnis | Register | Rohwert |", "|---|---|---|---|");
		for (const it of last.items) {
			const def = it.def;
			const result =
				it.status === "ok"
					? `${fmtNum(it.value)} ${def.unit || ""}`.trim() + (it.warning ? ` ⚠ ${it.warning}` : "")
					: `Fehler: ${describeError(it.error)}`;
			const raw = it.raw === null || it.raw === undefined ? "—" : fmtRaw(it.raw);
			lines.push(`| ${mdCell(defName(def))} | ${mdCell(result)} | ${mdCell(metaText(def, null))} | ${raw} |`);
		}
	}
	lines.push(reportLog());
	const ok = await copyText(lines.join("\n"));
	setStatus(ok ? "ok" : "err", ok ? "Bericht in die Zwischenablage kopiert" : "Kopieren nicht möglich");
}
