// Mode "Fehlersuche": a guided check that walks from "is the bridge running" to
// "are the values plausible" and stops at the first broken link with a concrete hint.

import * as api from "./api.js";
import { $, esc, show, sleep, fcLabel, copyText } from "./util.js";
import { app, on, setStatus } from "./state.js";
import { readDefs } from "./reader.js";
import { describeError } from "./errors.js";
import { setConnValues, probeAddress } from "./connection.js";
import { reportHeader, reportLog } from "./report.js";

const STEPS = [
	["bridge", "wbecModbus läuft"],
	["network", "Gerät im Netzwerk erreichbar"],
	["modbus", "Gerät antwortet per Modbus (Unit-ID)"],
	["fc", "Register-Typ passt (Holding oder Input)"],
	["registers", "Alle Profil-Register lesbar"],
	["values", "Werte plausibel und aktuell"],
];
const ICONS = { pending: "○", running: "◌", ok: "✓", warn: "⚠", fail: "✗", skip: "–" };
const UNIT_CANDIDATES = [1, 2, 3, 4, 100, 126, 240, 247, 0, 255];
const OBSERVE_SAMPLES = 3;
const OBSERVE_INTERVAL = 5000;

let steps = {};
let runId = 0; // incremented to cancel a running diagnosis
let running = false;

export function initDiagnose() {
	reset();
	$("btnDiagRun").addEventListener("click", () => (running ? cancel() : run()));
	$("btnDiagReport").addEventListener("click", copyReport);
	$("diagSteps").addEventListener("click", (e) => {
		const btn = e.target.closest("[data-action]");
		if (btn && steps[btn.dataset.action].action) steps[btn.dataset.action].action.run();
	});
	const invalidate = () => {
		if (!running) reset();
	};
	on("profile", invalidate);
	on("conn", invalidate);
}

function reset() {
	steps = Object.fromEntries(STEPS.map(([id, title]) => [id, { id, title, status: "pending", detail: "", action: null }]));
	render();
}

function set(id, status, detail = "", action = null) {
	Object.assign(steps[id], { status, detail, action });
	render();
}

// Marks every not-yet-checked step from `id` on as skipped.
function skipFrom(id, why = "nicht geprüft") {
	let skipping = false;
	for (const [sid] of STEPS) {
		if (sid === id) skipping = true;
		if (skipping && steps[sid].status === "pending") set(sid, "skip", why);
	}
}

function render() {
	$("diagSteps").innerHTML = STEPS.map(([id]) => {
		const s = steps[id];
		return `
<div class="dstep dstep--${s.status}">
	<span class="dstep__icon">${ICONS[s.status]}</span>
	<div class="dstep__body">
		<div class="dstep__title">${esc(s.title)}</div>
		${s.detail ? `<div class="dstep__detail">${esc(s.detail)}</div>` : ""}
	</div>
	${s.action ? `<button class="btn btn--sm" data-action="${id}">${esc(s.action.label)}</button>` : ""}
</div>`;
	}).join("");
	$("btnDiagRun").textContent = running ? "■ Abbrechen" : "▶ Diagnose starten";
	$("btnDiagRun").classList.toggle("btn--danger", running);
	show($("diagIntro"), STEPS.every(([id]) => steps[id].status === "pending"));
}

function cancel() {
	runId++;
	running = false;
	for (const [id] of STEPS) {
		if (steps[id].status === "running") Object.assign(steps[id], { status: "skip", detail: "abgebrochen", action: null });
	}
	skipFrom(STEPS[0][0], "abgebrochen");
	setStatus("idle", "Diagnose abgebrochen");
	render();
}

// Runs `fn(alive)` as the current task; alive() turns false once it was cancelled.
async function task(fn) {
	const id = ++runId;
	running = true;
	render();
	const alive = () => id === runId;
	try {
		await fn(alive);
	} finally {
		if (alive()) {
			running = false;
			render();
		}
	}
}

function run() {
	return task(async (alive) => {
		reset();
		setStatus("busy", "Diagnose läuft …");
		await runSteps(alive);
		if (!alive()) return;
		const failed = STEPS.some(([id]) => steps[id].status === "fail");
		const warned = STEPS.some(([id]) => steps[id].status === "warn");
		setStatus(failed ? "err" : warned ? "warn" : "ok", failed ? "Diagnose: Problem gefunden" : warned ? "Diagnose: Hinweise beachten" : "Diagnose: alles in Ordnung");
	});
}

function networkHint(kind, conn) {
	switch (kind) {
		case "connect-timeout":
			return "Stimmt die IP-Adresse? Ist das Gerät eingeschaltet und im selben Netz (nicht im Gast-WLAN)? Blockiert eine Firewall?";
		case "refused":
			return `Das Gerät ist erreichbar, aber Port ${conn.port} ist geschlossen: Modbus TCP im Wechselrichter aktivieren und den Port prüfen (SolarEdge meist 1502, sonst 502).`;
		case "unreachable":
			return "Die Adresse ist ungültig oder das Netz nicht erreichbar – IP-Adresse prüfen.";
		case "noip":
			return "Oben in der Verbindungsleiste die IP-Adresse eintragen.";
		default:
			return "";
	}
}

function modbusHint(kind) {
	switch (kind) {
		case "timeout":
			return "Das Gerät nimmt die Verbindung an, antwortet aber nicht – meist passt die Unit-ID nicht.";
		case "closed":
			return "Manche Geräte erlauben nur einen Modbus-Client gleichzeitig: wbec kurz trennen und erneut prüfen. Sonst die Unit-ID prüfen.";
		default:
			return "";
	}
}

async function runSteps(alive) {
	const conn = { ...app.conn };
	const profile = app.profile;

	// 1 — bridge
	set("bridge", "running");
	const info = await api.ping();
	if (!alive()) return;
	if (!info.version) {
		set("bridge", "fail", "wbecModbus antwortet nicht – läuft die EXE noch? Danach diese Seite neu laden.");
		return skipFrom("network");
	}
	set("bridge", "ok", `Version ${info.version}`);

	// 2 — TCP connection, 3 — Modbus answer (one probe read covers both)
	if (!conn.ip) {
		set("network", "fail", networkHint("noip", conn));
		return skipFrom("modbus");
	}
	set("network", "running", `Verbinde mit ${conn.ip}:${conn.port} …`);
	const probe = probeAddress();
	const first = await api.readBatch(conn, [{ start: probe, count: 1 }], { note: "Diagnose" });
	if (!alive()) return;
	if (first.connectionError) {
		const e = first.connectionError;
		set("network", "fail", `${describeError(e)}. ${networkHint(e.errorKind, conn)}`);
		return skipFrom("modbus");
	}
	set("network", "ok", `${conn.ip}:${conn.port} nimmt Verbindungen an (${first.connectMs} ms).`);

	const pr = first.results[0];
	if (!pr.success && pr.errorKind !== "exception") {
		set("modbus", "fail", `Unit-ID ${conn.unit}: ${describeError(pr)}. ${modbusHint(pr.errorKind)}`, {
			label: "Unit-ID suchen",
			run: () => searchUnit(conn, probe),
		});
		return skipFrom("fc");
	}
	set(
		"modbus",
		"ok",
		pr.success
			? `Unit-ID ${conn.unit} antwortet (${pr.durationMs} ms).`
			: `Unit-ID ${conn.unit} antwortet – Register ${probe} meldet allerdings: ${describeError(pr)}.`
	);

	if (!profile || !profile.registers.length) {
		return skipFrom("fc", "Ohne Wechselrichter-Typ (Profil) nicht prüfbar – oben einen Typ wählen.");
	}

	// 4 — register type
	set("fc", "running", `Lese ${profile.registers.length} Profil-Register …`);
	const res = await readDefs(conn, profile.registers, { note: "Diagnose" });
	if (!alive()) return;
	if (res.connError) {
		set("fc", "fail", describeError(res.connError));
		return skipFrom("registers");
	}
	if (res.ok === 0) {
		const other = conn.function === 3 ? 4 : 3;
		set("fc", "running", `Kein Wert mit ${fcLabel(conn.function)} – probiere ${fcLabel(other)} …`);
		const alt = await readDefs({ ...conn, function: other }, profile.registers, { note: "Diagnose: anderer Register-Typ" });
		if (!alive()) return;
		if (alt.ok > 0) {
			set("fc", "fail", `Mit ${fcLabel(conn.function)} kommt kein Wert, mit ${fcLabel(other)} schon (${alt.ok} von ${alt.items.length}).`, {
				label: `${fcLabel(other)} übernehmen`,
				run: () => {
					setConnValues({ function: other });
					run();
				},
			});
		} else {
			set("fc", "fail", `Weder Holding- noch Input-Register lesbar (${describeError(res.items[0].error)}). Passt der Wechselrichter-Typ zum Gerät bzw. zur Firmware?`);
		}
		return skipFrom("registers");
	}
	set("fc", "ok", `${fcLabel(conn.function)} liefern Daten.`);

	// 5 — every profile register
	const n = res.items.length;
	if (res.failed === 0) {
		set("registers", "ok", `${n} von ${n} Registern gelesen.`);
	} else {
		const bad = res.items
			.filter((it) => it.status !== "ok")
			.map((it) => `${it.def.name || it.def.address}: ${describeError(it.error)}`);
		set("registers", "warn", `${res.ok} von ${n} gelesen. ${bad.join(" · ")}`);
	}

	// 6 — observe for a while: plausible, and do the values move at all?
	const samples = [res];
	for (let k = 1; k <= OBSERVE_SAMPLES; k++) {
		set("values", "running", `Beobachte die Werte (${((k - 1) * OBSERVE_INTERVAL) / 1000} von ${(OBSERVE_SAMPLES * OBSERVE_INTERVAL) / 1000} s) …`);
		await sleep(OBSERVE_INTERVAL);
		if (!alive()) return;
		samples.push(await readDefs(conn, profile.registers, { log: "errors", note: "Diagnose" }));
		if (!alive()) return;
	}
	const latest = samples[samples.length - 1];
	const warnings = latest.items
		.filter((it) => it.status === "ok" && it.warning)
		.map((it) => `${it.def.name || it.def.address}: ${it.warning}`);
	const changed = profile.registers.filter((_, i) => {
		const seen = new Set(samples.map((s) => (s.items[i].status === "ok" ? s.items[i].value : "–")));
		return seen.size > 1;
	}).length;
	const seconds = (OBSERVE_SAMPLES * OBSERVE_INTERVAL) / 1000;
	if (latest.ok === 0) {
		set("values", "fail", `Beim Beobachten kam kein Wert mehr: ${describeError(latest.connError || latest.items[0].error)}.`);
	} else if (warnings.length) {
		set("values", "warn", warnings.join(" · "));
	} else if (changed === 0) {
		set("values", "warn", `In ${seconds} s hat sich kein Wert geändert. Nachts oder ohne Last ist das normal – tagsüber Register und Skalierung prüfen.`);
	} else {
		set("values", "ok", `Werte ändern sich und wirken plausibel (${changed} von ${n} haben sich in ${seconds} s verändert).`);
	}
}

function searchUnit(conn, probe) {
	return task(async (alive) => {
		const candidates = UNIT_CANDIDATES.filter((u) => u !== Number(conn.unit));
		for (const u of candidates) {
			set("modbus", "running", `Teste Unit-ID ${u} …`);
			setStatus("busy", `Suche Unit-ID (${u}) …`);
			const r = await api.readBatch({ ...conn, unit: u }, [{ start: probe, count: 1 }], { note: "Unit-ID-Suche" });
			if (!alive()) return;
			if (r.connectionError) {
				set("modbus", "fail", describeError(r.connectionError));
				return setStatus("err", "Unit-ID-Suche abgebrochen");
			}
			const x = r.results[0];
			if (x.success || x.errorKind === "exception") {
				set("modbus", "warn", `Gefunden: Unit-ID ${u} antwortet.`, {
					label: `Unit-ID ${u} übernehmen`,
					run: () => {
						setConnValues({ unit: u });
						run();
					},
				});
				return setStatus("ok", `Unit-ID ${u} gefunden`);
			}
		}
		set("modbus", "fail", `Keine der getesteten Unit-IDs (${candidates.join(", ")}) antwortet. Die Unit-ID steht in der Anleitung bzw. im Menü des Wechselrichters.`, {
			label: "Erneut suchen",
			run: () => searchUnit(conn, probe),
		});
		setStatus("err", "Keine Unit-ID gefunden");
	});
}

async function copyReport() {
	const lines = [reportHeader("Fehlersuche")];
	if (STEPS.every(([id]) => steps[id].status === "pending")) {
		lines.push("_Diagnose wurde noch nicht ausgeführt._");
	} else {
		for (const [id] of STEPS) {
			const s = steps[id];
			lines.push(`- ${ICONS[s.status]} **${s.title}**${s.detail ? ` – ${s.detail}` : ""}`);
		}
	}
	lines.push(reportLog());
	const ok = await copyText(lines.join("\n"));
	setStatus(ok ? "ok" : "err", ok ? "Bericht in die Zwischenablage kopiert" : "Kopieren nicht möglich");
}
