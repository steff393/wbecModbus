// Mode "Register erforschen": read a range, find registers by a value known from
// the manufacturer's app, watch them over time and assemble a new profile — for
// inverter types wbec does not support yet.

import { readBatch } from "./api.js";
import { $, esc, show, fmtNum, parseNum, parseIntIn, download, stamp, toCsv, clock } from "./util.js";
import { load, save } from "./storage.js";
import { app, on, setStatus, startPoller, stopPoller, pollerOwner } from "./state.js";
import { readDefs } from "./reader.js";
import { describeError } from "./errors.js";
import { logEntry } from "./log.js";
import { createHistory, renderChart } from "./chart.js";
import { typeOptions, endianOptions, normalizeDefs } from "./editor.js";
import * as I from "./interpret.js";

const BLOCK = 125; // Modbus maximum per request
const MAX_SPAN = 10000;
const SCALES = [1, 0.1, 0.01, 0.001, 10, 100, 1000];
const MAX_SEARCH_RESULTS = 200;

const st = {
	registers: {}, // the register table: address -> raw word
	changed: new Set(), // addresses whose value changed in the last update (colour flash)
	baseline: null, // snapshot for the "nur geändert" filter
	filter: { nonzero: false, changed: false },
	scanning: false,
	abort: false,
	missing: 0, // registers the device rejected during the last range read
	lastRender: 0,
	search: [],
	detailAddr: null,
	watch: load("watch", []), // [{id, address, type, endian, scale, offset, scaleRegister, name, unit}]
	watchValues: {}, // watch id -> last readDefs item
	draft: load("draft", []), // profile draft rows (as edited, strings allowed)
};
const history = createHistory(720); // key: watch id
let openEditor = () => {};

const fmtRaw = (raw) => (Number.isInteger(raw) ? String(raw) : I.fmtFloat(raw));

export function initExplore(opts) {
	openEditor = opts.openEditor;
	const range = load("range", null);
	if (range) {
		$("rangeFrom").value = range.from;
		$("rangeTo").value = range.to;
	}
	const interval = String(load("watchInterval", 5));
	if ([...$("watchInterval").options].some((o) => o.value === interval)) $("watchInterval").value = interval;

	$("btnRange").addEventListener("click", readRange);
	$("btnSearch").addEventListener("click", runSearch);
	for (const [ids, fn] of [[["rangeFrom", "rangeTo"], readRange], [["searchValue", "searchTol"], runSearch]]) {
		for (const id of ids) $(id).addEventListener("keydown", (e) => e.key === "Enter" && fn());
	}
	$("searchTable").addEventListener("click", onSearchClick);
	wireTable();
	wireDetails();
	$("btnWatch").addEventListener("click", () => (pollerOwner() === "explore" ? stopPoller("explore") : startWatch()));
	$("watchInterval").addEventListener("change", () => {
		save("watchInterval", Number($("watchInterval").value));
		if (pollerOwner() === "explore") startWatch();
	});
	$("btnWatchCsv").addEventListener("click", exportWatchCsv);
	$("btnWatchClear").addEventListener("click", () => {
		history.clear();
		renderWatch();
	});
	$("watchList").addEventListener("click", onWatchClick);
	wireDraft();
	window.addEventListener("resize", () => app.mode === "explore" && renderWatch());

	on("profile", renderTable); // name tags in the table
	renderTable();
	renderWatch();
	renderDraft();
	updateWatchButton();
}

// Start address of the range — used to probe the device when no profile is chosen.
export function exploreProbeAddress() {
	const n = parseIntIn($("rangeFrom").value, 0, 65535);
	return n === null ? 0 : n;
}

function profileDefAt(addr) {
	return app.profile ? app.profile.registers.find((d) => Number(d.address) === addr) || null : null;
}

// --- 1 · Range read -----------------------------------------------------------

async function readRange() {
	if (st.scanning) {
		st.abort = true; // the button acts as "cancel" while reading
		return;
	}
	const from = parseIntIn($("rangeFrom").value, 0, 65535);
	const to = parseIntIn($("rangeTo").value, 0, 65535);
	if (from === null || to === null || to < from) {
		return setStatus("err", "Bitte einen gültigen Bereich angeben (0–65535, „bis“ ≥ „von“)");
	}
	if (to - from + 1 > MAX_SPAN) return setStatus("err", `Höchstens ${MAX_SPAN} Register auf einmal`);
	save("range", { from, to });
	stopPoller(); // never poll and scan the device at the same time

	const previous = st.registers;
	st.registers = {};
	st.changed = new Set();
	st.missing = 0;
	setScanning(true);
	setStatus("busy", `Lese ${from}–${to} …`);
	const total = to - from + 1;
	let done = 0;
	let failure = null;
	try {
		for (let addr = from; addr <= to && !st.abort; addr += BLOCK) {
			const count = Math.min(BLOCK, to - addr + 1);
			failure = await readBlock(addr, count);
			if (failure) break;
			done += count;
			updateProgress(done, total);
			if (performance.now() - st.lastRender > 250) renderTable();
		}
	} finally {
		setScanning(false);
	}

	for (const [k, v] of Object.entries(st.registers)) {
		const a = Number(k);
		if (previous[a] !== undefined && previous[a] !== v) st.changed.add(a);
	}
	renderTable();
	const read = Object.keys(st.registers).length;
	const missing = st.missing ? `, ${st.missing} nicht vorhanden` : "";
	if (failure) setStatus("err", `${failure} – ${read} Register gelesen${missing}`);
	else if (st.abort) setStatus("warn", `Abgebrochen bei ${done} von ${total} – ${read} Register gelesen${missing}`);
	else setStatus(read ? "ok" : "warn", `${read} Register gelesen${missing}`);
}

// Reads one block; returns an error text or null.
async function readBlock(start, count) {
	const res = await readBatch(app.conn, [{ start, count }], { note: "Bereich lesen" });
	if (res.connectionError) return describeError(res.connectionError);
	const r = res.results[0];
	if (r.success) {
		Object.assign(st.registers, r.data);
		return null;
	}
	if (r.errorKind !== "exception") return `Register ${start}: ${describeError(r)}`;
	// Many devices reject the whole block when a single address in it does not exist.
	return refine(start, count);
}

// Narrows a rejected block down (25er blocks, then single registers) so every
// readable register still ends up in the table.
async function refine(start, count) {
	if (st.abort) return null;
	const size = count > 25 ? 25 : 1;
	const ranges = [];
	for (let a = start; a < start + count; a += size) ranges.push({ start: a, count: Math.min(size, start + count - a) });

	const t0 = performance.now();
	const res = await readBatch(app.conn, ranges, { log: "none" });
	if (res.connectionError) return describeError(res.connectionError);
	let readable = 0;
	let missing = 0;
	for (const r of res.results) {
		if (r.success) {
			Object.assign(st.registers, r.data);
			readable += r.count;
		} else if (r.errorKind !== "exception") {
			return `Register ${r.start}: ${describeError(r)}`;
		} else if (r.count > 1) {
			const err = await refine(r.start, r.count);
			if (err) return err;
		} else {
			missing++;
			st.missing++;
		}
	}
	if (size === 1) {
		logEntry({
			time: Date.now(), fc: Number(app.conn.function), start, count, ok: true,
			values: `${readable} lesbar, ${missing} nicht vorhanden`, ms: Math.round(performance.now() - t0), note: "Lücken eingrenzen",
		});
	}
	return null;
}

function setScanning(on) {
	st.scanning = on;
	if (on) st.abort = false;
	const btn = $("btnRange");
	btn.textContent = on ? "■ Abbrechen" : "Lesen";
	btn.classList.toggle("btn--danger", on);
	btn.classList.toggle("btn--primary", !on);
	show($("rangeProgress"), on);
	if (on) updateProgress(0, 1);
}

function updateProgress(done, total) {
	const pct = Math.min(100, Math.round((done / total) * 100));
	$("rangeBar").style.width = pct + "%";
	$("rangeText").textContent = `${Math.min(done, total)} / ${total} (${pct}%)`;
}

// --- 2 · Search by a known value -------------------------------------------------

function runSearch() {
	const target = parseNum($("searchValue").value);
	const tol = Math.abs(parseNum($("searchTol").value) || 0);
	const info = $("searchInfo");
	if (!Number.isFinite(target)) {
		info.textContent = "Bitte einen Zahlenwert eingeben.";
		return;
	}
	const addresses = Object.keys(st.registers).map(Number).sort((a, b) => a - b);
	if (!addresses.length) {
		info.textContent = "Erst einen Bereich lesen – gesucht wird in den gelesenen Registern.";
		return;
	}

	const results = [];
	for (const addr of addresses) {
		const a = st.registers[addr];
		const b = st.registers[addr + 1];
		for (const interp of I.INTERPRETATIONS) {
			const raw = I.rawValue(interp.type, interp.endian, a, b);
			if (raw === null || !Number.isFinite(raw)) continue;
			for (const scale of SCALES) {
				const scaled = raw * scale;
				const diff = Math.abs(scaled - target);
				if (diff <= tol) results.push({ addr, interp, raw, scale, scaled, diff });
			}
		}
	}
	results.sort((x, y) => x.diff - y.diff || x.addr - y.addr);
	st.search = results.slice(0, MAX_SEARCH_RESULTS);
	const what = `${fmtNum(target)} (± ${fmtNum(tol)})`;
	info.textContent = results.length
		? `${results.length} Treffer für ${what}${results.length > MAX_SEARCH_RESULTS ? ` – die besten ${MAX_SEARCH_RESULTS} werden gezeigt` : ""}`
		: `Keine Treffer für ${what}. Toleranz erhöhen oder einen anderen Bereich lesen.`;
	renderSearch();
}

function renderSearch() {
	show($("searchCard"), st.search.length > 0);
	$("searchCount").textContent = st.search.length ? `${st.search.length} angezeigt` : "";
	$("searchTable").innerHTML = st.search
		.map(
			(r, i) => `
<tr data-addr="${r.addr}">
	<td class="mono">${r.addr}</td>
	<td>${r.interp.label}</td>
	<td class="mono">${esc(fmtRaw(r.raw))}</td>
	<td class="mono dim">×${fmtNum(r.scale)}</td>
	<td class="mono"><b>${fmtNum(r.scaled)}</b></td>
	<td class="row-actions"><button class="btn btn--ghost btn--sm" data-act="watch" data-i="${i}">beobachten</button><button class="btn btn--ghost btn--sm" data-act="draft" data-i="${i}">ins Profil</button></td>
</tr>`
		)
		.join("");
}

function onSearchClick(e) {
	const btn = e.target.closest("[data-act]");
	if (btn) {
		const r = st.search[Number(btn.dataset.i)];
		const def = { address: r.addr, type: r.interp.type, endian: r.interp.endian, scale: r.scale };
		return btn.dataset.act === "watch" ? addWatch(def) : addDraft(def);
	}
	const row = e.target.closest("tr[data-addr]");
	if (row) scrollToRow(Number(row.dataset.addr));
}

// --- Register table ---------------------------------------------------------

function visibleAddresses() {
	let addresses = Object.keys(st.registers).map(Number).sort((a, b) => a - b);
	if (st.filter.nonzero) addresses = addresses.filter((a) => st.registers[a] !== 0);
	if (st.filter.changed) {
		if (!st.baseline) return [];
		addresses = addresses.filter((a) => st.baseline[a] !== undefined && st.baseline[a] !== st.registers[a]);
	}
	return addresses;
}

function renderTable() {
	st.lastRender = performance.now();
	const total = Object.keys(st.registers).length;
	const addresses = visibleAddresses();
	const watched = new Set(st.watch.map((w) => Number(w.address)));
	const rows = addresses
		.map((addr) => {
			const v = st.registers[addr];
			const b = st.registers[addr + 1];
			const has32 = b !== undefined;
			const def = profileDefAt(addr);
			const chg = st.changed.has(addr) ? " chg" : "";
			return `
<tr data-addr="${addr}">
	<td class="col-check"><input type="checkbox" data-watch="${addr}" title="beobachten"${watched.has(addr) ? " checked" : ""}></td>
	<td class="mono addr">${addr}${def ? `<span class="tag">${esc(def.name)}</span>` : ""}</td>
	<td class="mono dim${chg}">${I.toHex16(v)}</td>
	<td class="mono${chg}">${v}</td>
	<td class="mono${chg}">${I.toInt16(v)}</td>
	<td class="mono dim${chg}">${has32 ? I.toUint32BE(v, b) : ""}</td>
	<td class="mono dim${chg}">${has32 ? I.fmtFloat(I.toFloatBE(v, b)) : ""}</td>
</tr>`;
		})
		.join("");

	const emptyMsg =
		total === 0
			? "Noch keine Register gelesen – oben einen Bereich lesen."
			: st.filter.changed && !st.baseline
			? "Keine Basis gesetzt – erst „Basis setzen“ oder einen Snapshot importieren."
			: "Keine Register passen zum Filter.";
	$("regTable").innerHTML = rows || `<tr><td colspan="7" class="empty">${emptyMsg}</td></tr>`;
	$("regCount").textContent = total
		? addresses.length === total
			? `${total} Register`
			: `${addresses.length} / ${total} Register`
		: "";
}

function flashRow(addr) {
	const row = document.querySelector(`#regTable tr[data-addr="${addr}"]`);
	if (!row) return;
	row.classList.remove("flash");
	void row.offsetWidth; // restart the animation
	row.classList.add("flash");
}

function scrollToRow(addr) {
	const row = document.querySelector(`#regTable tr[data-addr="${addr}"]`);
	if (!row) return;
	row.scrollIntoView({ block: "center", behavior: "smooth" });
	flashRow(addr);
}

function wireTable() {
	$("filterNonzero").addEventListener("change", (e) => {
		st.filter.nonzero = e.target.checked;
		renderTable();
	});
	$("filterChanged").addEventListener("change", (e) => {
		st.filter.changed = e.target.checked;
		renderTable();
	});
	$("btnBaseline").addEventListener("click", () => {
		st.baseline = { ...st.registers };
		setStatus("ok", `Basis gesetzt (${Object.keys(st.baseline).length} Register) – später erneut lesen und „nur geändert“ wählen`);
		renderTable();
	});
	$("btnExportCsv").addEventListener("click", exportCsv);
	$("btnExportJson").addEventListener("click", exportJson);
	$("btnImport").addEventListener("click", () => $("importFile").click());
	$("importFile").addEventListener("change", (e) => {
		if (e.target.files[0]) importSnapshot(e.target.files[0]);
		e.target.value = ""; // allow re-importing the same file
	});
	$("btnClear").addEventListener("click", () => {
		st.registers = {};
		st.changed = new Set();
		renderTable();
		setStatus("ok", "Registertabelle geleert");
	});

	// Table: checkbox = watch, click = details, hover = tooltip with all interpretations.
	const table = $("regTable");
	table.addEventListener("change", (e) => {
		if (e.target.matches("input[data-watch]")) toggleWatchAddr(Number(e.target.dataset.watch), e.target.checked);
	});
	table.addEventListener("click", (e) => {
		if (e.target.matches("input")) return;
		const row = e.target.closest("tr[data-addr]");
		if (row) {
			hideTooltip();
			openDetails(Number(row.dataset.addr));
		}
	});
	table.addEventListener("mouseover", (e) => {
		const row = e.target.closest("tr[data-addr]");
		if (row) showTooltip(Number(row.dataset.addr), e.clientX, e.clientY);
	});
	table.addEventListener("mousemove", (e) => {
		if ($("tooltip").style.display === "block") moveTooltip(e.clientX, e.clientY);
	});
	table.addEventListener("mouseout", (e) => {
		if (!e.relatedTarget || !e.relatedTarget.closest("#regTable tr[data-addr]")) hideTooltip();
	});
}

function showTooltip(addr, x, y) {
	const rows = I.allInterpretations(addr, st.registers);
	if (rows.length === 0) return;
	const def = profileDefAt(addr);
	let extra = "";
	if (def) {
		const val = I.evaluateDef(def, st.registers).value;
		extra = `<div class="tt-profile">${esc(def.name)}: <b>${fmtNum(val)} ${esc(def.unit || "")}</b></div>`;
	}
	const tooltip = $("tooltip");
	tooltip.innerHTML =
		`<div class="tt-head">Register ${addr}</div>${extra}` +
		rows.map((r) => `<div class="tt-row"><span>${r.label}</span><b>${esc(r.value)}</b></div>`).join("");
	tooltip.style.display = "block";
	moveTooltip(x, y);
}

function moveTooltip(x, y) {
	const tooltip = $("tooltip");
	const pad = 14;
	const rect = tooltip.getBoundingClientRect();
	let left = x + pad;
	let top = y + pad;
	if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
	if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
	tooltip.style.left = Math.max(4, left) + "px";
	tooltip.style.top = Math.max(4, top) + "px";
}

function hideTooltip() {
	$("tooltip").style.display = "none";
}

// CSV of the visible rows with every interpretation as a column.
function exportCsv() {
	const addresses = visibleAddresses();
	if (addresses.length === 0) return setStatus("err", "Nichts zu exportieren");
	const rows = [["Adresse", "hex", "uint16", "int16", "uint32 BE", "uint32 LE", "int32 BE", "int32 LE", "float BE", "float LE"]];
	for (const addr of addresses) {
		const a = st.registers[addr];
		const b = st.registers[addr + 1];
		const has32 = b !== undefined;
		rows.push([
			addr, I.toHex16(a), a, I.toInt16(a),
			has32 ? I.toUint32BE(a, b) : "", has32 ? I.toUint32LE(a, b) : "",
			has32 ? I.toInt32BE(a, b) : "", has32 ? I.toInt32LE(a, b) : "",
			has32 ? I.toFloatBE(a, b) : "", has32 ? I.toFloatLE(a, b) : "",
		]);
	}
	download(`modbus-${stamp()}.csv`, toCsv(rows), "text/csv");
	setStatus("ok", `${addresses.length} Zeilen als CSV exportiert`);
}

// Full snapshot as JSON — re-importable as comparison baseline.
function exportJson() {
	const addresses = Object.keys(st.registers).map(Number).sort((a, b) => a - b);
	if (addresses.length === 0) return setStatus("err", "Nichts zu exportieren");
	const registers = {};
	for (const a of addresses) registers[a] = st.registers[a];
	const snapshot = {
		meta: { app: "wbecModbus", exported: new Date().toISOString(), profile: app.profile ? app.profile.name : "", ...app.conn },
		registers,
	};
	download(`modbus-${stamp()}.json`, JSON.stringify(snapshot, null, 2), "application/json");
	setStatus("ok", `${addresses.length} Register als JSON exportiert`);
}

// Import a snapshot: it becomes the baseline for "nur geändert" and fills the table
// when it is empty.
async function importSnapshot(file) {
	try {
		const parsed = JSON.parse(await file.text());
		const raw = parsed.registers || parsed; // accept our export or a bare map
		const snapshot = {};
		for (const [k, v] of Object.entries(raw)) {
			const addr = Number(k);
			if (Number.isInteger(addr) && typeof v === "number") snapshot[addr] = v;
		}
		if (Object.keys(snapshot).length === 0) return setStatus("err", "Keine Register im Snapshot");
		st.baseline = snapshot;
		if (Object.keys(st.registers).length === 0) st.registers = { ...snapshot };
		renderTable();
		setStatus("ok", `Snapshot importiert – Basis gesetzt (${Object.keys(snapshot).length} Register)`);
	} catch (e) {
		setStatus("err", "Import fehlgeschlagen: " + e.message);
	}
}

// --- Register details ---------------------------------------------------------

function wireDetails() {
	const box = $("details");
	const close = () => {
		box.classList.add("hidden");
		st.detailAddr = null;
	};
	$("detailsClose").addEventListener("click", close);
	$("detailsClose2").addEventListener("click", close);
	box.addEventListener("click", (e) => e.target === box && close());
	$("detailsReload").addEventListener("click", reloadDetail);
	$("detailsBody").addEventListener("click", (e) => {
		const btn = e.target.closest("[data-act]");
		if (!btn) return;
		const def = { address: st.detailAddr, type: btn.dataset.type, endian: btn.dataset.endian, scale: 1 };
		btn.dataset.act === "watch" ? addWatch(def) : addDraft(def);
	});
}

function openDetails(addr) {
	st.detailAddr = addr;
	renderDetails();
	$("details").classList.remove("hidden");
}

function renderDetails() {
	const addr = st.detailAddr;
	if (addr === null) return;
	const a = st.registers[addr];
	const b = st.registers[addr + 1];
	const def = profileDefAt(addr);
	$("detailsTitle").textContent = `Register ${addr}${def ? ` – ${def.name}` : ""}`;
	if (a === undefined) {
		$("detailsBody").innerHTML = `<p class="muted">Noch kein Wert – „Neu lesen“ klicken.</p>`;
		return;
	}
	const profileLine = def
		? `<p class="tt-profile">Laut Profil: ${esc(def.name)} = <b>${fmtNum(I.evaluateDef(def, st.registers).value)} ${esc(def.unit || "")}</b></p>`
		: "";
	const basics = `<div class="interp-basic mono"><span>hex <b>${I.toHex16(a)}</b></span><span>binär <b>${I.toBin16(a)}</b></span><span>ascii <b>${esc(I.toAscii(a))}</b></span></div>`;
	const rows = I.INTERPRETATIONS.map((x) => {
		const raw = I.rawValue(x.type, x.endian, a, b);
		if (raw === null) return "";
		const data = `data-type="${x.type}" data-endian="${x.endian}"`;
		return `<tr><td>${x.label}</td><td class="mono"><b>${esc(fmtRaw(raw))}</b></td><td class="row-actions"><button class="btn btn--ghost btn--sm" data-act="watch" ${data}>beobachten</button><button class="btn btn--ghost btn--sm" data-act="draft" ${data}>ins Profil</button></td></tr>`;
	}).join("");
	const note = b === undefined ? `<p class="hint">Für 32-Bit-Deutungen fehlt Register ${addr + 1} – „Neu lesen“ liest beide.</p>` : "";
	$("detailsBody").innerHTML = profileLine + basics + `<table class="interp"><tbody>${rows}</tbody></table>` + note;
}

async function reloadDetail() {
	const addr = st.detailAddr;
	if (addr === null) return;
	let res = await readBatch(app.conn, [{ start: addr, count: addr < 65535 ? 2 : 1 }], { note: "Register neu lesen" });
	if (!res.connectionError && !res.results[0].success && res.results[0].errorKind === "exception" && addr < 65535) {
		res = await readBatch(app.conn, [{ start: addr, count: 1 }], { note: "Register neu lesen" }); // successor may not exist
	}
	const r = res.results[0];
	if (!r.success) return setStatus("err", `Register ${addr}: ${describeError(res.connectionError || r)}`);
	st.changed = new Set();
	for (const [k, v] of Object.entries(r.data)) {
		const a = Number(k);
		if (st.registers[a] !== undefined && st.registers[a] !== v) st.changed.add(a);
		st.registers[a] = v;
	}
	renderDetails();
	renderTable();
	flashRow(addr);
	setStatus("ok", `Register ${addr} neu gelesen`);
}

// --- 3 · Watch and history ------------------------------------------------------

function watchLabel(w) {
	return w.name || `Register ${w.address}`;
}

function watchKey(w) {
	return [w.address, w.type, w.endian, w.scale, w.scaleRegister ?? ""].join("|");
}

function addWatch(def) {
	const w = {
		id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		address: Number(def.address),
		type: def.type || "uint16",
		endian: def.endian || "big",
		scale: Number(def.scale ?? 1) || 1,
		offset: Number(def.offset ?? 0) || 0,
		scaleRegister: I.hasScaleRegister(def) ? Number(def.scaleRegister) : null,
		name: def.name || "",
		unit: def.unit || "",
	};
	if (st.watch.some((x) => watchKey(x) === watchKey(w))) return setStatus("ok", `${watchLabel(w)} (${I.typeLabel(w)}) wird schon beobachtet`);
	st.watch.push(w);
	save("watch", st.watch);
	renderWatch();
	renderTable();
	setStatus("ok", `${watchLabel(w)} (${I.typeLabel(w)}) wird beobachtet – „Start“ liest zyklisch`);
}

function removeWatch(id) {
	st.watch = st.watch.filter((w) => w.id !== id);
	history.delete(id);
	delete st.watchValues[id];
	save("watch", st.watch);
	if (!st.watch.length) stopPoller("explore");
	renderWatch();
	renderTable();
}

function toggleWatchAddr(addr, on) {
	if (on) addWatch(profileDefAt(addr) || { address: addr, type: "uint16" });
	else for (const w of st.watch.filter((x) => Number(x.address) === addr)) removeWatch(w.id);
}

function startWatch() {
	if (!st.watch.length) return setStatus("err", "Erst Register zum Beobachten auswählen");
	if (st.scanning) return setStatus("err", "Bitte warten, bis das Lesen des Bereichs fertig ist");
	startPoller("explore", Number($("watchInterval").value) * 1000, pollWatch, updateWatchButton);
	updateWatchButton();
}

function updateWatchButton() {
	const running = pollerOwner() === "explore";
	const btn = $("btnWatch");
	btn.textContent = running ? "■ Stopp" : "▶ Start";
	btn.classList.toggle("btn--danger", running);
	btn.classList.toggle("btn--primary", !running);
}

async function pollWatch() {
	const entries = st.watch.slice();
	if (!entries.length) return stopPoller("explore");
	const res = await readDefs(app.conn, entries, { log: "errors", note: "Beobachten" });
	entries.forEach((w, i) => {
		const it = res.items[i];
		st.watchValues[w.id] = it;
		history.push(w.id, res.time, it.status === "ok" ? it.value : null);
	});
	st.changed = new Set();
	for (const [k, v] of Object.entries(res.regs)) {
		const a = Number(k);
		if (st.registers[a] === undefined) continue; // only refresh rows already in the table
		if (st.registers[a] !== v) st.changed.add(a);
		st.registers[a] = v;
	}
	renderWatch();
	renderTable();
	const n = entries.length;
	if (res.connError) setStatus("err", describeError(res.connError));
	else if (res.failed) setStatus("warn", `Beobachten · ${clock(res.time)} · ${res.failed} von ${n} fehlgeschlagen`);
	else setStatus("ok", `Beobachten · ${clock(res.time)} · ${n} ${n === 1 ? "Wert" : "Werte"}`);
}

function renderWatch() {
	$("watchCount").textContent = String(st.watch.length);
	const list = $("watchList");
	if (!st.watch.length) {
		list.innerHTML = `<p class="empty">Noch nichts ausgewählt. Register in der Tabelle anhaken oder bei Suchtreffern „beobachten“ wählen.</p>`;
		return;
	}
	list.innerHTML = st.watch
		.map((w) => {
			const it = st.watchValues[w.id];
			const value = !it ? "—" : it.status === "ok" ? `${fmtNum(it.value)} ${esc(w.unit)}` : "Fehler";
			const scale = Number(w.scale) !== 1 ? ` ×${fmtNum(Number(w.scale), 6)}` : "";
			let note = "";
			if (it && it.status !== "ok") note = `<div class="wcard__note">${esc(describeError(it.error))}</div>`;
			else if (it && it.warning) note = `<div class="wcard__note wcard__note--warn">${esc(it.warning)}</div>`;
			return `
<div class="wcard" data-id="${w.id}">
	<div class="wcard__head">
		<span class="wcard__name">${esc(watchLabel(w))}</span>
		<span class="mono dim">${w.address} · ${I.typeLabel(w)}${scale}</span>
		<span class="wcard__value mono">${value}</span>
		<span class="wcard__actions"><button class="btn btn--ghost btn--sm" data-act="draft">ins Profil</button><button class="btn btn--ghost btn--sm" data-act="remove" title="nicht mehr beobachten">✕</button></span>
	</div>
	${note}
	<div class="chart chart--small" data-chart="${w.id}"></div>
</div>`;
		})
		.join("");
	for (const w of st.watch) {
		renderChart(list.querySelector(`[data-chart="${w.id}"]`), history.get(w.id), { unit: w.unit, height: 100 });
	}
}

function onWatchClick(e) {
	const btn = e.target.closest("[data-act]");
	const card = e.target.closest("[data-id]");
	if (!btn || !card) return;
	const w = st.watch.find((x) => x.id === card.dataset.id);
	if (!w) return;
	if (btn.dataset.act === "remove") removeWatch(w.id);
	else addDraft(w);
}

function exportWatchCsv() {
	if (!st.watch.length) return setStatus("err", "Nichts zu exportieren");
	const times = [...new Set(st.watch.flatMap((w) => history.get(w.id).map((p) => p.t)))].sort((a, b) => a - b);
	if (!times.length) return setStatus("err", "Noch kein Verlauf – erst „Start“ klicken");
	const maps = st.watch.map((w) => new Map(history.get(w.id).map((p) => [p.t, p.v])));
	const rows = [["Zeit", ...st.watch.map((w) => `${watchLabel(w)} (${w.address} ${I.typeLabel(w)})${w.unit ? ` [${w.unit}]` : ""}`)]];
	for (const t of times) rows.push([new Date(t).toLocaleString("de-DE"), ...maps.map((m) => (m.has(t) ? m.get(t) : ""))]);
	download(`beobachtung-${stamp()}.csv`, toCsv(rows), "text/csv");
}

// --- 4 · Profile draft ----------------------------------------------------------

function saveDraft() {
	save("draft", st.draft);
}

function addDraft(def) {
	st.draft.push({
		address: Number(def.address),
		name: def.name || "",
		type: def.type || "uint16",
		endian: def.endian || "big",
		scale: def.scale ?? 1,
		offset: def.offset ?? 0,
		unit: def.unit || "",
		scaleRegister: I.hasScaleRegister(def) ? Number(def.scaleRegister) : "",
	});
	saveDraft();
	renderDraft();
	setStatus("ok", `Register ${def.address} (${I.typeLabel(def)}) zum Profil-Entwurf hinzugefügt – Name und Einheit unten ergänzen`);
}

function renderDraft() {
	$("draftCount").textContent = st.draft.length ? `${st.draft.length} Register` : "";
	$("draftTable").innerHTML = st.draft.length
		? st.draft
				.map(
					(r, i) => `
<tr>
	<td><input class="mono" data-d="address" data-i="${i}" value="${esc(r.address)}"></td>
	<td><input data-d="name" data-i="${i}" value="${esc(r.name)}" placeholder="z. B. PV-Leistung"></td>
	<td><select data-d="type" data-i="${i}">${typeOptions(r.type)}</select></td>
	<td><select data-d="endian" data-i="${i}">${endianOptions(r.endian)}</select></td>
	<td><input class="mono" data-d="scale" data-i="${i}" value="${esc(r.scale)}"></td>
	<td><input class="mono" data-d="scaleRegister" data-i="${i}" value="${esc(r.scaleRegister ?? "")}" placeholder="–"></td>
	<td><input data-d="unit" data-i="${i}" value="${esc(r.unit)}" placeholder="W"></td>
	<td><button class="btn btn--ghost btn--sm" data-del="${i}" title="entfernen">✕</button></td>
</tr>`
				)
				.join("")
		: `<tr><td colspan="8" class="empty">Noch leer – über „ins Profil“ bei Suchtreffern, in den Register-Details oder beim Beobachten Register sammeln.</td></tr>`;
}

function wireDraft() {
	const table = $("draftTable");
	const onEdit = (e) => {
		const field = e.target.dataset.d;
		if (!field) return;
		st.draft[Number(e.target.dataset.i)][field] = e.target.value;
		saveDraft();
	};
	table.addEventListener("input", onEdit);
	table.addEventListener("change", onEdit);
	table.addEventListener("click", (e) => {
		const del = e.target.dataset.del;
		if (del === undefined) return;
		st.draft.splice(Number(del), 1);
		saveDraft();
		renderDraft();
	});

	$("btnDraftFromProfile").addEventListener("click", () => {
		if (!app.profile) return setStatus("err", "Oben ist kein Wechselrichter-Typ gewählt");
		if (st.draft.length && !confirm("Den aktuellen Entwurf durch die Register des gewählten Profils ersetzen?")) return;
		st.draft = app.profile.registers.map((r) => ({ ...r, scaleRegister: I.hasScaleRegister(r) ? r.scaleRegister : "" }));
		saveDraft();
		renderDraft();
		setStatus("ok", `${st.draft.length} Register aus „${app.profile.name}“ übernommen`);
	});
	$("btnDraftWatch").addEventListener("click", () => {
		const defs = normalizeDefs(st.draft);
		if (!defs.length) return setStatus("err", "Der Entwurf enthält keine gültigen Register");
		for (const d of defs) addWatch(d);
	});
	$("btnDraftSave").addEventListener("click", () => {
		const defs = normalizeDefs(st.draft);
		if (!defs.length) return setStatus("err", "Der Entwurf enthält keine gültigen Register");
		openEditor({ registers: defs });
	});
	$("btnDraftJson").addEventListener("click", () => {
		const defs = normalizeDefs(st.draft);
		if (!defs.length) return setStatus("err", "Der Entwurf enthält keine gültigen Register");
		const c = app.conn;
		const profile = { name: "Neuer Wechselrichter", ip: "", port: Number(c.port), unit: Number(c.unit), function: Number(c.function), registers: defs };
		download(`profil-entwurf-${stamp()}.json`, JSON.stringify(profile, null, 2), "application/json");
	});
	$("btnDraftClear").addEventListener("click", () => {
		if (!st.draft.length || !confirm("Profil-Entwurf leeren?")) return;
		st.draft = [];
		saveDraft();
		renderDraft();
	});
}
