import * as api from "./api.js";
import * as I from "./interpret.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
	registers: {}, // addr(number) -> raw uint16
	watch: new Set(), // watched addresses (numbers)
	changed: new Set(), // addresses changed in the last update (for colour flash)
	baseline: null, // snapshot for the "only changed" filter (addr -> value) or null
	filter: { nonzero: false, changed: false },
	scanning: false, // frontend scan in progress
	scanAbort: false, // set by the cancel button
	profiles: [],
	activeProfile: null, // Profile object or null
	pollTimer: null,
	editRegisters: [], // register defs while editing a profile
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function config() {
	return {
		ip: $("ip").value.trim(),
		port: Number($("port").value),
		unit: Number($("unit").value),
		function: Number($("function").value),
	};
}

// ---------------------------------------------------------------------------
// IP-Adresse: Verlauf (Dropdown mit freier Texteingabe via <datalist>)
// ---------------------------------------------------------------------------

const IP_HISTORY_KEY = "wbecModbus.ipHistory";
const IP_HISTORY_MAX = 10;

function loadIpHistory() {
	try {
		const raw = JSON.parse(localStorage.getItem(IP_HISTORY_KEY));
		return Array.isArray(raw) ? raw : [];
	} catch {
		return [];
	}
}

function renderIpHistory(history) {
	$("ipHistory").innerHTML = history.map((ip) => `<option value="${ip}">`).join("");
}

// Adds/moves an IP to the front of the remembered list and refreshes the datalist.
function rememberIp(ip) {
	ip = ip.trim();
	if (!ip) return;
	const history = [ip, ...loadIpHistory().filter((v) => v !== ip)].slice(0, IP_HISTORY_MAX);
	localStorage.setItem(IP_HISTORY_KEY, JSON.stringify(history));
	renderIpHistory(history);
}

function setStatus(kind, text) {
	const el = $("status");
	el.className = "status status--" + kind; // ok | err | busy | idle
	el.querySelector(".status__text").textContent = text;
}

function sortedAddresses(obj) {
	return Object.keys(obj)
		.map(Number)
		.sort((a, b) => a - b);
}

// Merge freshly read values into the store (does not drop existing ones).
function mergeRegisters(data) {
	for (const [k, v] of Object.entries(data)) {
		state.registers[Number(k)] = v;
	}
}

// Like mergeRegisters, but records which already-present registers changed so the
// table can flash them (used for cyclic polling and single-register refresh).
function diffAndMerge(data) {
	state.changed = new Set();
	for (const [k, v] of Object.entries(data)) {
		const addr = Number(k);
		if (state.registers[addr] !== undefined && state.registers[addr] !== v) {
			state.changed.add(addr);
		}
		state.registers[addr] = v;
	}
}

// Addresses currently visible in the register table, after filters.
function visibleAddresses() {
	let addresses = sortedAddresses(state.registers);
	if (state.filter.nonzero) {
		addresses = addresses.filter((a) => state.registers[a] !== 0);
	}
	if (state.filter.changed) {
		if (!state.baseline) return [];
		addresses = addresses.filter(
			(a) => state.baseline[a] !== undefined && state.baseline[a] !== state.registers[a]
		);
	}
	return addresses;
}

// ---------------------------------------------------------------------------
// Modbus actions
// ---------------------------------------------------------------------------

async function doRead() {
	const start = Number($("start").value);
	const count = Number($("count").value);
	setStatus("busy", "Lese …");
	try {
		const res = await api.readRegisters(config(), start, count);
		if (!res.success) return setStatus("err", res.error);
		state.registers = {}; // a fresh read replaces the table
		mergeRegisters(res.data);
		renderTable();
		renderProfileValues();
		setStatus("ok", `${Object.keys(res.data).length} Register gelesen`);
	} catch (e) {
		setStatus("err", String(e));
	}
}

// Frontend-driven scan: reads the range in 125-register blocks so we can show
// progress and cancel between blocks. /modbus/scan stays as a server fallback.
async function doScan() {
	if (state.scanning) {
		state.scanAbort = true; // button acts as "cancel" while scanning
		return;
	}

	const from = Number($("scanFrom").value);
	const to = Number($("scanTo").value);
	if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
		return setStatus("err", "Ungültiger Scan-Bereich");
	}

	const cfg = config();
	const BLOCK = 125;
	const total = to - from + 1;

	state.registers = {};
	state.changed = new Set();
	setScanning(true);
	setStatus("busy", "Scanne …");

	let done = 0;
	try {
		for (let addr = from; addr <= to && !state.scanAbort; ) {
			const count = Math.min(BLOCK, to - addr + 1);
			const res = await api.readRegisters(cfg, addr, count);
			if (!res.success) {
				setStatus("err", res.error);
				break;
			}
			mergeRegisters(res.data);
			done += count;
			addr += count;
			updateScanProgress(done, total);
			renderTable();
			await sleep(50); // brief pause + lets the UI repaint / cancel take effect
		}
		renderProfileValues();
		if (state.scanAbort) {
			setStatus("ok", `Scan abgebrochen bei ${done}/${total}`);
		} else {
			setStatus("ok", `${Object.keys(state.registers).length} Register gescannt`);
		}
	} catch (e) {
		setStatus("err", String(e));
	} finally {
		setScanning(false);
	}
}

function setScanning(on) {
	state.scanning = on;
	state.scanAbort = false;
	const btn = $("btnScan");
	btn.textContent = on ? "■ Abbrechen" : "Bereich scannen";
	btn.classList.toggle("btn--danger", on);
	$("scanProgress").classList.toggle("hidden", !on);
	if (!on) $("scanBar").style.width = "0%";
}

function updateScanProgress(done, total) {
	const pct = Math.min(100, Math.round((done / total) * 100));
	$("scanBar").style.width = pct + "%";
	$("scanText").textContent = `${Math.min(done, total)} / ${total} (${pct}%)`;
}

// Re-read a single register (plus its successor, for 32-bit interpretation).
async function refreshRegister(addr) {
	try {
		const res = await api.readRegisters(config(), addr, 2);
		if (!res.success) return setStatus("err", res.error);
		diffAndMerge(res.data);
		renderTable();
		renderProfileValues();
		flashRow(addr);
		setStatus("ok", `Register ${addr} aktualisiert`);
	} catch (e) {
		setStatus("err", String(e));
	}
}

function flashRow(addr) {
	const row = document.querySelector(`tr[data-addr="${addr}"]`);
	if (!row) return;
	row.classList.remove("flash");
	void row.offsetWidth; // restart the animation
	row.classList.add("flash");
}

// ---------------------------------------------------------------------------
// Cyclic polling (watch list)
// ---------------------------------------------------------------------------

async function pollWatch() {
	const addrs = [...state.watch].sort((a, b) => a - b);
	if (addrs.length === 0) return;

	try {
		let data = {};
		for (const addr of addrs) {
			const res = await api.readRegisters(config(), addr, 1);
			if (!res.success) {
				setStatus("err", res.error);
				return;
			}
			Object.assign(data, res.data);
		}
		diffAndMerge(data);
		renderTable();
		renderWatch();
		renderProfileValues();
		setStatus("ok", `Zyklisch aktualisiert (${addrs.length} Register)`);
	} catch (e) {
		setStatus("err", String(e));
	}
}

function startPolling() {
	if (state.pollTimer) return;
	if (state.watch.size === 0) {
		setStatus("err", "Keine Register markiert");
		return;
	}
	const interval = Math.max(200, Number($("pollInterval").value) || 5000);
	pollWatch();
	state.pollTimer = setInterval(pollWatch, interval);
	$("pollToggle").textContent = "■ Stoppen";
	$("pollToggle").classList.add("btn--danger");
}

function stopPolling() {
	if (state.pollTimer) {
		clearInterval(state.pollTimer);
		state.pollTimer = null;
	}
	$("pollToggle").textContent = "▶ Zyklisch lesen";
	$("pollToggle").classList.remove("btn--danger");
}

function togglePolling() {
	state.pollTimer ? stopPolling() : startPolling();
}

// ---------------------------------------------------------------------------
// Register table
// ---------------------------------------------------------------------------

function renderTable() {
	const total = Object.keys(state.registers).length;
	const addresses = visibleAddresses();
	const rows = addresses
		.map((addr) => {
			const v = state.registers[addr];
			const b = state.registers[addr + 1];
			const has32 = b !== undefined;
			const checked = state.watch.has(addr) ? "checked" : "";
			const named = profileNameFor(addr);
			const chg = state.changed.has(addr) ? " chg" : "";
			return `
<tr data-addr="${addr}">
	<td class="col-check"><input type="checkbox" data-addr="${addr}" ${checked}></td>
	<td class="mono addr">${addr}${named ? `<span class="tag">${named}</span>` : ""}</td>
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
			? "Noch keine Register gelesen."
			: state.filter.changed && !state.baseline
			? "Keine Basis gesetzt – erst „Basis setzen“ oder einen Snapshot importieren."
			: "Keine Register passen zum Filter.";
	$("table").innerHTML = rows || `<tr><td colspan="7" class="empty">${emptyMsg}</td></tr>`;

	$("tableCount").textContent = total
		? addresses.length === total
			? `${total} Register`
			: `${addresses.length} / ${total} Register`
		: "";
}

function profileNameFor(addr) {
	if (!state.activeProfile) return "";
	const def = state.activeProfile.registers.find((d) => d.address === addr);
	return def ? def.name : "";
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

const tooltip = $("tooltip");

function showTooltip(addr, x, y) {
	const rows = I.allInterpretations(addr, state.registers);
	if (rows.length === 0) return;

	let extra = "";
	if (state.activeProfile) {
		const def = state.activeProfile.registers.find((d) => d.address === addr);
		if (def) {
			const val = I.interpretDef(def, state.registers);
			extra = `<div class="tt-profile">${def.name}: <b>${
				val === null ? "—" : I.fmtFloat(val)
			} ${def.unit || ""}</b></div>`;
		}
	}

	tooltip.innerHTML =
		`<div class="tt-head">Register ${addr}</div>${extra}` +
		rows
			.map((r) => `<div class="tt-row"><span>${r.label}</span><b>${r.value}</b></div>`)
			.join("");
	tooltip.style.display = "block";
	moveTooltip(x, y);
}

function moveTooltip(x, y) {
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
	tooltip.style.display = "none";
}

// ---------------------------------------------------------------------------
// Search with adjustable tolerance and scale factors
// ---------------------------------------------------------------------------

const SCALES = [1, 0.1, 0.01, 0.001, 10, 100, 1000];

function runSearch() {
	const target = Number($("searchValue").value);
	const tol = Math.abs(Number($("searchTol").value) || 0);
	if (Number.isNaN(target)) return;

	const addresses = sortedAddresses(state.registers);
	const results = [];
	const seen = new Set();

	const candidates = (addr) => {
		const a = state.registers[addr];
		const b = state.registers[addr + 1];
		const list = [
			["uint16", a],
			["int16", I.toInt16(a)],
		];
		if (b !== undefined) {
			list.push(
				["uint32 BE", I.toUint32BE(a, b)],
				["uint32 LE", I.toUint32LE(a, b)],
				["int32 BE", I.toInt32BE(a, b)],
				["int32 LE", I.toInt32LE(a, b)],
				["float BE", I.toFloatBE(a, b)],
				["float LE", I.toFloatLE(a, b)]
			);
		}
		return list;
	};

	for (const addr of addresses) {
		for (const [type, raw] of candidates(addr)) {
			if (!isFinite(raw)) continue;
			for (const scale of SCALES) {
				const scaled = raw * scale;
				const diff = Math.abs(scaled - target);
				if (diff <= tol) {
					const key = `${addr}|${type}|${scale}`;
					if (seen.has(key)) continue;
					seen.add(key);
					results.push({ addr, type, raw, scale, scaled, diff });
				}
			}
		}
	}

	results.sort((x, y) => x.diff - y.diff || x.addr - y.addr);
	renderSearch(results, target, tol);
}

function renderSearch(results, target, tol) {
	$("searchInfo").textContent = results.length
		? `${results.length} Treffer für ${target} (± ${tol})`
		: `Keine Treffer für ${target} (± ${tol})`;

	$("searchTable").innerHTML = results
		.map(
			(r) => `
<tr data-addr="${r.addr}">
	<td class="mono">${r.addr}</td>
	<td>${r.type}</td>
	<td class="mono">${I.fmtFloat(r.raw)}</td>
	<td class="mono dim">×${r.scale}</td>
	<td class="mono"><b>${I.fmtFloat(r.scaled)}</b></td>
</tr>`
		)
		.join("");
}

// ---------------------------------------------------------------------------
// Watch panel
// ---------------------------------------------------------------------------

function renderWatch() {
	const addrs = [...state.watch].sort((a, b) => a - b);
	$("watchCount").textContent = addrs.length ? `${addrs.length}` : "0";
	$("watchTable").innerHTML = addrs.length
		? addrs
				.map((addr) => {
					const v = state.registers[addr];
					const def =
						state.activeProfile &&
						state.activeProfile.registers.find((d) => d.address === addr);
					let interpreted = v === undefined ? "—" : v;
					if (def) {
						const val = I.interpretDef(def, state.registers);
						interpreted = `${val === null ? "—" : I.fmtFloat(val)} ${def.unit || ""}`;
					}
					return `
<tr>
	<td class="mono">${addr}${def ? `<span class="tag">${def.name}</span>` : ""}</td>
	<td class="mono">${v === undefined ? "—" : v}</td>
	<td class="mono"><b>${interpreted}</b></td>
	<td><button class="btn btn--ghost btn--sm" data-unwatch="${addr}">✕</button></td>
</tr>`;
				})
				.join("")
		: `<tr><td colspan="4" class="empty">Register in der Tabelle markieren.</td></tr>`;
}

function toggleWatch(addr, on) {
	if (on) state.watch.add(addr);
	else state.watch.delete(addr);
	renderWatch();
}

// ---------------------------------------------------------------------------
// Filters, baseline snapshot, export & import
// ---------------------------------------------------------------------------

function setBaseline() {
	state.baseline = { ...state.registers };
	setStatus("ok", `Basis gesetzt (${Object.keys(state.baseline).length} Register)`);
	renderTable();
}

function clearRegisters() {
	state.registers = {};
	state.changed = new Set();
	renderTable();
	renderProfileValues();
	renderWatch();
	setStatus("ok", "Registertabelle geleert");
}

function download(filename, text, mime) {
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

function stamp() {
	return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

// CSV of the currently visible rows, with every interpretation as a column.
function exportCsv() {
	const addresses = visibleAddresses();
	if (addresses.length === 0) return setStatus("err", "Nichts zu exportieren");
	const header = [
		"address", "hex", "uint16", "int16",
		"uint32_be", "uint32_le", "int32_be", "int32_le", "float_be", "float_le",
	];
	const lines = [header.join(",")];
	for (const addr of addresses) {
		const a = state.registers[addr];
		const b = state.registers[addr + 1];
		const has32 = b !== undefined;
		lines.push(
			[
				addr,
				I.toHex16(a),
				a,
				I.toInt16(a),
				has32 ? I.toUint32BE(a, b) : "",
				has32 ? I.toUint32LE(a, b) : "",
				has32 ? I.toInt32BE(a, b) : "",
				has32 ? I.toInt32LE(a, b) : "",
				has32 ? I.fmtFloat(I.toFloatBE(a, b)) : "",
				has32 ? I.fmtFloat(I.toFloatLE(a, b)) : "",
			].join(",")
		);
	}
	download(`modbus-${stamp()}.csv`, lines.join("\r\n"), "text/csv");
	setStatus("ok", `${addresses.length} Zeilen als CSV exportiert`);
}

// Full snapshot as JSON — re-importable as a comparison baseline.
function exportJson() {
	const addresses = sortedAddresses(state.registers);
	if (addresses.length === 0) return setStatus("err", "Nichts zu exportieren");
	const registers = {};
	for (const a of addresses) registers[a] = state.registers[a];
	const snapshot = {
		meta: { app: "wbecModbus", exported: new Date().toISOString(), ...config() },
		registers,
	};
	download(`modbus-${stamp()}.json`, JSON.stringify(snapshot, null, 2), "application/json");
	setStatus("ok", `${addresses.length} Register als JSON exportiert`);
}

// Import a snapshot JSON: sets it as the baseline for the "only changed" filter,
// and loads the values into the table if it is currently empty.
async function importSnapshot(file) {
	try {
		const text = await file.text();
		const parsed = JSON.parse(text);
		const raw = parsed.registers || parsed; // accept our export or a bare map
		const snapshot = {};
		for (const [k, v] of Object.entries(raw)) {
			const addr = Number(k);
			if (!Number.isNaN(addr) && typeof v === "number") snapshot[addr] = v;
		}
		if (Object.keys(snapshot).length === 0) return setStatus("err", "Keine Register im Snapshot");

		state.baseline = snapshot;
		if (Object.keys(state.registers).length === 0) {
			state.registers = { ...snapshot };
		}
		renderTable();
		setStatus("ok", `Snapshot importiert – Basis gesetzt (${Object.keys(snapshot).length} Register)`);
	} catch (e) {
		setStatus("err", "Import fehlgeschlagen: " + e.message);
	}
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

async function loadProfiles(selectName) {
	state.profiles = await api.listProfiles();
	const sel = $("profileSelect");
	sel.innerHTML =
		`<option value="">— kein Profil —</option>` +
		state.profiles.map((p) => `<option value="${p.name}">${p.name}</option>`).join("");
	if (selectName) sel.value = selectName;
	applySelectedProfile();
}

function applySelectedProfile() {
	const name = $("profileSelect").value;
	const profile = state.profiles.find((p) => p.name === name) || null;
	const currentIp = $("ip").value.trim();
	const currentPort = $("port").value.trim();
	const currentUnit = $("unit").value.trim();
	const currentFunction = $("function").value.trim();
	state.activeProfile = profile;
	if (profile) {
		$("ip").value = profile.ip ? profile.ip : currentIp;
		rememberIp($("ip").value);
		$("port").value = profile.port !== undefined && profile.port !== null && profile.port !== "" ? profile.port : currentPort;
		$("unit").value = profile.unit !== undefined && profile.unit !== null && profile.unit !== "" ? profile.unit : currentUnit;
		$("function").value = profile.function !== undefined && profile.function !== null && profile.function !== "" ? profile.function : currentFunction;
	} else {
		$("ip").value = currentIp;
		$("port").value = currentPort;
		$("unit").value = currentUnit;
		$("function").value = currentFunction;
	}
	renderProfileValues();
	renderTable();
	renderWatch();
}

// Read all registers defined by the active profile and show physical values.
async function readProfileRegisters() {
	if (!state.activeProfile || state.activeProfile.registers.length === 0) {
		setStatus("err", "Kein Profil mit Registern gewählt");
		return;
	}
	setStatus("busy", "Lese Profil-Register …");
	try {
		for (const def of state.activeProfile.registers) {
			const res = await api.readRegisters(config(), def.address, I.defWidth(def));
			if (res.success) mergeRegisters(res.data);
		}
		renderTable();
		renderProfileValues();
		setStatus("ok", "Profil-Register gelesen");
	} catch (e) {
		setStatus("err", String(e));
	}
}

function renderProfileValues() {
	const panel = $("profilePanel");
	if (!state.activeProfile || state.activeProfile.registers.length === 0) {
		panel.classList.add("hidden");
		return;
	}
	panel.classList.remove("hidden");
	$("profilePanelName").textContent = state.activeProfile.name;
	$("profileValues").innerHTML = state.activeProfile.registers
		.map((def) => {
			const val = I.interpretDef(def, state.registers);
			const raw = state.registers[def.address];
			return `
<tr data-addr="${def.address}">
	<td>${def.name}</td>
	<td class="mono">${def.address}</td>
	<td class="mono dim">${def.type}${def.endian === "little" ? " LE" : ""}</td>
	<td class="mono dim">${raw === undefined ? "—" : raw}</td>
	<td class="mono"><b>${val === null ? "—" : I.fmtFloat(val)}</b> ${def.unit || ""}</td>
</tr>`;
		})
		.join("");
}

// --- Profile editor -------------------------------------------------------

function openEditor(fromActive) {
	const p = fromActive && state.activeProfile ? state.activeProfile : null;
	$("edName").value = p ? p.name : "";
	$("edIp").value = p ? p.ip : $("ip").value;
	$("edPort").value = p ? p.port : $("port").value;
	$("edUnit").value = p ? p.unit : $("unit").value;
	$("edFunction").value = p ? p.function : $("function").value;
	state.editRegisters = p ? p.registers.map((r) => ({ ...r })) : [];
	renderEditorRegisters();
	$("editor").classList.remove("hidden");
}

function closeEditor() {
	$("editor").classList.add("hidden");
}

function renderEditorRegisters() {
	$("edRegisters").innerHTML = state.editRegisters
		.map(
			(r, i) => `
<tr>
	<td><input class="mono" data-ed="address" data-i="${i}" value="${r.address}"></td>
	<td><input data-ed="name" data-i="${i}" value="${r.name || ""}"></td>
	<td>
		<select data-ed="type" data-i="${i}">
			${["uint16", "int16", "uint32", "int32", "float32"]
				.map((t) => `<option ${r.type === t ? "selected" : ""}>${t}</option>`)
				.join("")}
		</select>
	</td>
	<td>
		<select data-ed="endian" data-i="${i}">
			<option value="big" ${r.endian !== "little" ? "selected" : ""}>big</option>
			<option value="little" ${r.endian === "little" ? "selected" : ""}>little</option>
		</select>
	</td>
	<td><input class="mono" data-ed="scale" data-i="${i}" value="${r.scale ?? 1}"></td>
	<td><input class="mono" data-ed="offset" data-i="${i}" value="${r.offset ?? 0}"></td>
	<td><input data-ed="unit" data-i="${i}" value="${r.unit || ""}"></td>
	<td><button class="btn btn--ghost btn--sm" data-delrow="${i}">✕</button></td>
</tr>`
		)
		.join("");
}

function collectEditorRegisters() {
	// Values are kept in sync via input handler; just return current array.
	return state.editRegisters
		.filter((r) => r.address !== "" && !Number.isNaN(Number(r.address)))
		.map((r) => ({
			address: Number(r.address),
			name: r.name || "",
			type: r.type || "uint16",
			endian: r.endian || "big",
			scale: Number(r.scale) || 1,
			offset: Number(r.offset) || 0,
			unit: r.unit || "",
		}));
}

async function saveEditor() {
	const name = $("edName").value.trim();
	if (!name) return setStatus("err", "Profilname fehlt");
	const currentPort = Number($("port").value) || 502;
	const currentUnit = Number($("unit").value) || 0;
	const currentFunction = Number($("function").value) || 3;
	const effectiveIp = $("edIp").value.trim() || $("ip").value.trim();
	const effectivePort = $("edPort").value.trim() !== "" ? Number($("edPort").value) || 502 : currentPort;
	const effectiveUnit = $("edUnit").value.trim() !== "" ? Number($("edUnit").value) || 0 : currentUnit;
	const effectiveFunction = $("edFunction").value.trim() !== "" ? Number($("edFunction").value) || 3 : currentFunction;
	const profile = {
		name,
		ip: effectiveIp,
		port: effectivePort,
		unit: effectiveUnit,
		function: effectiveFunction,
		registers: collectEditorRegisters(),
	};
	const res = await api.saveProfile(profile);
	if (!res.success) return setStatus("err", res.error);
	closeEditor();
	await loadProfiles(name);
	setStatus("ok", `Profil "${name}" gespeichert`);
}

async function deleteActiveProfile() {
	const name = $("profileSelect").value;
	if (!name) return;
	if (!confirm(`Profil "${name}" löschen?`)) return;
	const res = await api.deleteProfile(name);
	if (!res.success) return setStatus("err", res.error);
	await loadProfiles("");
	setStatus("ok", `Profil "${name}" gelöscht`);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wire() {
	$("btnRead").addEventListener("click", doRead);
	$("btnScan").addEventListener("click", doScan);
	$("btnSearch").addEventListener("click", runSearch);
	$("pollToggle").addEventListener("click", togglePolling);

	renderIpHistory(loadIpHistory());
	$("ip").addEventListener("change", () => rememberIp($("ip").value));

	// Help / manual.
	const help = $("help");
	$("btnHelp").addEventListener("click", () => help.classList.remove("hidden"));
	$("helpClose").addEventListener("click", () => help.classList.add("hidden"));
	$("helpClose2").addEventListener("click", () => help.classList.add("hidden"));
	help.addEventListener("click", (e) => {
		if (e.target === help) help.classList.add("hidden"); // click on backdrop
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			help.classList.add("hidden");
			$("editor").classList.add("hidden");
		}
	});

	// Table toolbar: filters, baseline, export, import, clear.
	$("filterNonzero").addEventListener("change", (e) => {
		state.filter.nonzero = e.target.checked;
		renderTable();
	});
	$("filterChanged").addEventListener("change", (e) => {
		state.filter.changed = e.target.checked;
		renderTable();
	});
	$("btnBaseline").addEventListener("click", setBaseline);
	$("btnExportCsv").addEventListener("click", exportCsv);
	$("btnExportJson").addEventListener("click", exportJson);
	$("btnImport").addEventListener("click", () => $("importFile").click());
	$("btnClear").addEventListener("click", clearRegisters);
	$("importFile").addEventListener("change", (e) => {
		if (e.target.files[0]) importSnapshot(e.target.files[0]);
		e.target.value = ""; // allow re-importing the same file
	});

	$("profileSelect").addEventListener("change", applySelectedProfile);
	$("btnProfileRead").addEventListener("click", readProfileRegisters);
	$("btnProfileNew").addEventListener("click", () => openEditor(false));
	$("btnProfileEdit").addEventListener("click", () => openEditor(true));
	$("btnProfileDelete").addEventListener("click", deleteActiveProfile);

	$("edAddRow").addEventListener("click", () => {
		state.editRegisters.push({ address: "", name: "", type: "uint16", endian: "big", scale: 1, offset: 0, unit: "" });
		renderEditorRegisters();
	});
	$("edSave").addEventListener("click", saveEditor);
	$("edCancel").addEventListener("click", closeEditor);

	// Editor register inputs (delegated).
	$("edRegisters").addEventListener("input", (e) => {
		const field = e.target.dataset.ed;
		if (!field) return;
		const i = Number(e.target.dataset.i);
		state.editRegisters[i][field] = e.target.value;
	});
	$("edRegisters").addEventListener("click", (e) => {
		const del = e.target.dataset.delrow;
		if (del === undefined) return;
		state.editRegisters.splice(Number(del), 1);
		renderEditorRegisters();
	});

	// Watch remove buttons (delegated).
	$("watchTable").addEventListener("click", (e) => {
		const a = e.target.dataset.unwatch;
		if (a !== undefined) toggleWatch(Number(a), false);
	});

	// Main table: checkbox (watch), click (refresh), hover (tooltip).
	const table = $("table");
	table.addEventListener("change", (e) => {
		if (e.target.matches('input[type="checkbox"]')) {
			toggleWatch(Number(e.target.dataset.addr), e.target.checked);
		}
	});
	table.addEventListener("click", (e) => {
		if (e.target.matches("input")) return; // let the checkbox do its thing
		const row = e.target.closest("tr[data-addr]");
		if (row) refreshRegister(Number(row.dataset.addr));
	});
	table.addEventListener("mouseover", (e) => {
		const row = e.target.closest("tr[data-addr]");
		if (row) showTooltip(Number(row.dataset.addr), e.clientX, e.clientY);
	});
	table.addEventListener("mousemove", (e) => {
		if (tooltip.style.display === "block") moveTooltip(e.clientX, e.clientY);
	});
	table.addEventListener("mouseout", (e) => {
		if (!e.relatedTarget || !e.relatedTarget.closest("tr[data-addr]")) hideTooltip();
	});

	// Jump from a search/profile result to that register in the main table.
	for (const id of ["searchTable", "profileValues"]) {
		$(id).addEventListener("click", (e) => {
			const row = e.target.closest("tr[data-addr]");
			if (row) {
				const target = document.querySelector(`#table tr[data-addr="${row.dataset.addr}"]`);
				if (target) {
					target.scrollIntoView({ block: "center", behavior: "smooth" });
					flashRow(Number(row.dataset.addr));
				}
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
	wire();
	renderTable();
	renderWatch();
	try {
		const info = await api.ping();
		$("version").textContent = "v" + info.version;
		setStatus("ok", "Bereit");
	} catch {
		setStatus("err", "Bridge nicht erreichbar");
	}
	await loadProfiles("");
}

boot();
