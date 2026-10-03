// Connection bar (shared by all modes): inverter type (profile), IP with history,
// port / unit ID / register type, connection test.
//
// Settings are remembered per profile in the browser: the IP the user entered and
// any port / unit / function that deviates from the profile's defaults. Shipped
// profiles therefore never need to carry an IP.

import * as api from "./api.js";
import { $, esc, fcLabel, show, parseIntIn } from "./util.js";
import { load, save } from "./storage.js";
import { app, emit, setStatus } from "./state.js";
import { describeError } from "./errors.js";

const DEFAULTS = { port: 502, unit: 1, function: 3 };
const FIELDS = ["port", "unit", "function"];
const IP_HISTORY_MAX = 10;

let fallbackProbe = () => 0;

export function initConnection({ probeFallback, onEditProfile }) {
	fallbackProbe = probeFallback;
	$("profileSelect").addEventListener("change", () => selectProfile($("profileSelect").value));
	$("btnProfileEdit").addEventListener("click", () => app.profile && onEditProfile(app.profile));
	$("btnConnAdjust").addEventListener("click", () => {
		const adv = $("connAdvanced");
		show(adv, adv.classList.contains("hidden"));
		$("btnConnAdjust").textContent = adv.classList.contains("hidden") ? "anpassen" : "fertig";
	});
	$("btnConnReset").addEventListener("click", resetToProfile);
	for (const id of FIELDS) $(id).addEventListener("change", onFieldChange);
	$("btnTest").addEventListener("click", testConnection);
	wireIpCombo();
}

// --- Persistence ------------------------------------------------------------

function profileKey() {
	return app.profile ? app.profile.name : "";
}

function stored(name) {
	return load("connections", {})[name] || {};
}

function profileDefaults(p) {
	const has = (v) => v !== undefined && v !== null && v !== "";
	return {
		port: p && has(p.port) && Number(p.port) > 0 ? Number(p.port) : DEFAULTS.port,
		unit: p && has(p.unit) ? Number(p.unit) : DEFAULTS.unit,
		function: p && (Number(p.function) === 3 || Number(p.function) === 4) ? Number(p.function) : DEFAULTS.function,
	};
}

function overrides() {
	const d = profileDefaults(app.profile);
	const o = {};
	for (const k of FIELDS) if (Number(app.conn[k]) !== d[k]) o[k] = Number(app.conn[k]);
	return o;
}

function persist() {
	const all = load("connections", {});
	all[profileKey()] = { ip: app.conn.ip, ...overrides() };
	save("connections", all);
}

// --- Profiles ---------------------------------------------------------------

// (Re)loads the profile list. Without `selectName` the current (or, on start, the
// last used) profile stays selected.
export async function reloadProfiles(selectName) {
	app.profiles = await api.listProfiles();
	$("profileSelect").innerHTML =
		`<option value="">Unbekannt / ohne Profil</option>` +
		app.profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
	const wanted = selectName !== undefined ? selectName : app.profile ? app.profile.name : load("lastProfile", "");
	selectProfile(app.profiles.some((p) => p.name === wanted) ? wanted : "");
}

function selectProfile(name) {
	const profile = app.profiles.find((p) => p.name === name) || null;
	const saved = stored(name);
	const fixed = {};
	for (const k of FIELDS) if (saved[k] !== undefined) fixed[k] = Number(saved[k]);
	// Remembered IP for this type > IP in the profile file > what is in the field > last used IP.
	const ip = saved.ip || (profile && profile.ip) || app.conn.ip || ipHistory()[0] || "";

	app.profile = profile;
	app.conn = { ...profileDefaults(profile), ...fixed, ip };
	save("lastProfile", profile ? profile.name : "");
	persist();
	renderConn();
	emit("profile", profile);
	emit("conn", app.conn);
}

// --- Connection fields --------------------------------------------------------

function renderConn() {
	const c = app.conn;
	$("profileSelect").value = profileKey();
	$("ip").value = c.ip;
	$("port").value = c.port;
	$("unit").value = c.unit;
	$("function").value = String(c.function);
	$("connChips").innerHTML =
		`<span class="chip">Port ${c.port}</span><span class="chip">Unit-ID ${c.unit}</span><span class="chip">${fcLabel(c.function)}</span>`;
	const changed = Object.keys(overrides()).length > 0;
	$("connSource").textContent = app.profile
		? changed ? "angepasst – weicht vom Profil ab" : "aus dem Profil übernommen"
		: "Standardwerte";
	show($("btnConnReset"), changed);
	show($("btnProfileEdit"), !!app.profile);
	show($("testResult"), false);
}

function onFieldChange() {
	const port = parseIntIn($("port").value, 1, 65535);
	const unit = parseIntIn($("unit").value, 0, 255);
	if (port === null || unit === null) {
		setStatus("err", port === null ? "Port muss zwischen 1 und 65535 liegen" : "Unit-ID muss zwischen 0 und 255 liegen");
		renderConn(); // restore the last valid values
		return;
	}
	setConnValues({ port, unit, function: Number($("function").value) });
}

// Changes connection values from code (e.g. the diagnosis found the unit ID).
export function setConnValues(partial) {
	app.conn = { ...app.conn, ...partial };
	persist();
	renderConn();
	emit("conn", app.conn);
}

function resetToProfile() {
	setConnValues(profileDefaults(app.profile));
}

function setIp(value) {
	const ip = value.trim();
	rememberIp(ip);
	if (ip === app.conn.ip) return;
	setConnValues({ ip });
}

// Register used to probe the device: the profile's first register, else the
// explorer's start address.
export function probeAddress() {
	return app.profile && app.profile.registers.length ? Number(app.profile.registers[0].address) : fallbackProbe();
}

function showTestResult(kind, text) {
	const el = $("testResult");
	el.className = "test-result test-result--" + kind;
	el.textContent = text;
}

async function testConnection() {
	const probe = probeAddress();
	const btn = $("btnTest");
	btn.disabled = true;
	showTestResult("busy", "Teste …");
	setStatus("busy", "Teste Verbindung …");
	try {
		const res = await api.readBatch(app.conn, [{ start: probe, count: 1 }], { note: "Verbindungstest" });
		const r = res.results[0];
		if (res.connectionError) {
			showTestResult("err", "✗ " + describeError(res.connectionError));
			setStatus("err", describeError(res.connectionError));
		} else if (r.success) {
			showTestResult("ok", `✓ Gerät antwortet (${r.durationMs} ms)`);
			setStatus("ok", "Gerät antwortet");
		} else if (r.errorKind === "exception") {
			showTestResult("warn", `✓ Gerät antwortet – Register ${probe}: ${describeError(r)}`);
			setStatus("warn", "Gerät antwortet mit Modbus-Fehler");
		} else {
			showTestResult("err", "✗ " + describeError(r));
			setStatus("err", describeError(r));
		}
	} finally {
		btn.disabled = false;
	}
}

// --- IP field: free text input with a dropdown of recently used addresses --------
// (<input list> + <datalist> is not used on purpose: browsers filter its entries by
// the text already in the field, so a pre-filled field shows hardly any of them.)

let ipActiveIndex = -1; // entry highlighted via keyboard, -1 = none
let ipVisibleItems = [];

function ipHistory() {
	const h = load("ipHistory", []);
	return Array.isArray(h) ? h : [];
}

function rememberIp(ip) {
	if (!ip) return;
	save("ipHistory", [ip, ...ipHistory().filter((v) => v !== ip)].slice(0, IP_HISTORY_MAX));
}

function openIpDropdown() {
	ipActiveIndex = -1;
	ipVisibleItems = ipHistory();
	if (ipVisibleItems.length === 0) return closeIpDropdown();
	renderIpDropdown();
}

function renderIpDropdown() {
	$("ipList").innerHTML = ipVisibleItems
		.map(
			(ip, i) =>
				`<li class="combo__item${i === ipActiveIndex ? " combo__item--active" : ""}" role="option" data-ip="${esc(ip)}">${esc(ip)}</li>`
		)
		.join("");
	$("ipList").classList.remove("hidden");
	$("ip").setAttribute("aria-expanded", "true");
}

function closeIpDropdown() {
	$("ipList").classList.add("hidden");
	$("ip").setAttribute("aria-expanded", "false");
	ipActiveIndex = -1;
	ipVisibleItems = [];
}

function selectIp(ip) {
	$("ip").value = ip;
	setIp(ip);
	closeIpDropdown();
}

function wireIpCombo() {
	const input = $("ip");
	// "focus" covers tabbing into the field; "click" covers re-clicking a field that
	// already has focus (which doesn't fire "focus" again).
	input.addEventListener("focus", openIpDropdown);
	input.addEventListener("click", openIpDropdown);
	input.addEventListener("change", () => setIp(input.value));
	input.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if ($("ipList").classList.contains("hidden")) return openIpDropdown();
			if (ipVisibleItems.length === 0) return;
			const dir = e.key === "ArrowDown" ? 1 : -1;
			ipActiveIndex = (ipActiveIndex + dir + ipVisibleItems.length) % ipVisibleItems.length;
			renderIpDropdown();
		} else if (e.key === "Enter") {
			if (ipActiveIndex >= 0 && ipVisibleItems[ipActiveIndex]) {
				e.preventDefault();
				selectIp(ipVisibleItems[ipActiveIndex]);
			}
		} else if (e.key === "Escape") {
			closeIpDropdown();
		}
	});
	input.addEventListener("blur", () => setTimeout(closeIpDropdown, 150));

	// mousedown (not click) fires before the input's blur, so the list is still open.
	$("ipList").addEventListener("mousedown", (e) => {
		e.preventDefault();
		const li = e.target.closest("[data-ip]");
		if (li) selectIp(li.dataset.ip);
	});
}
