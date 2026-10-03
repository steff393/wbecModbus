// Profile editor (modal): name, connection defaults and register definitions.
// The IP is deliberately not part of it — it is remembered per profile in the
// browser, so profile files (and shipped profiles) stay free of device addresses.

import * as api from "./api.js";
import { $, esc, show, parseNum, parseIntIn } from "./util.js";
import { app, setStatus } from "./state.js";

const TYPES = ["uint16", "int16", "uint32", "int32", "float32"];

export function typeOptions(selected) {
	return TYPES.map((t) => `<option${t === selected ? " selected" : ""}>${t}</option>`).join("");
}

export function endianOptions(selected) {
	return `<option value="big"${selected !== "little" ? " selected" : ""}>big</option><option value="little"${selected === "little" ? " selected" : ""}>little</option>`;
}

// Turns edited rows (strings allowed) into clean RegisterDefs; rows without a valid
// address are dropped.
export function normalizeDefs(rows) {
	return rows
		.filter((r) => parseIntIn(r.address, 0, 65535) !== null)
		.map((r) => {
			const def = {
				address: parseIntIn(r.address, 0, 65535),
				name: String(r.name || "").trim(),
				type: TYPES.includes(r.type) ? r.type : "uint16",
				endian: r.endian === "little" ? "little" : "big",
				scale: Number.isFinite(parseNum(r.scale)) ? parseNum(r.scale) : 1,
				offset: Number.isFinite(parseNum(r.offset)) ? parseNum(r.offset) : 0,
				unit: String(r.unit || "").trim(),
			};
			const sf = parseIntIn(r.scaleRegister, 0, 65535);
			if (sf !== null) def.scaleRegister = sf;
			return def;
		});
}

let ctx = null; // { original: profile | null, rows: [...] }
let onSaved = async () => {};

export function initEditor({ saved }) {
	onSaved = saved;
	const close = () => $("editor").classList.add("hidden");
	$("edCancel").addEventListener("click", close);
	$("edCancel2").addEventListener("click", close);
	$("editor").addEventListener("click", (e) => e.target === $("editor") && close());
	$("edSave").addEventListener("click", saveEditor);
	$("edDelete").addEventListener("click", deleteProfile);
	$("edAddRow").addEventListener("click", () => {
		ctx.rows.push({ address: "", name: "", type: "uint16", endian: "big", scale: 1, offset: 0, unit: "", scaleRegister: "" });
		renderRows();
	});

	const rows = $("edRegisters");
	const onEdit = (e) => {
		const field = e.target.dataset.ed;
		if (field) ctx.rows[Number(e.target.dataset.i)][field] = e.target.value;
	};
	rows.addEventListener("input", onEdit);
	rows.addEventListener("change", onEdit);
	rows.addEventListener("click", (e) => {
		const del = e.target.dataset.delrow;
		if (del === undefined) return;
		ctx.rows.splice(Number(del), 1);
		renderRows();
	});
}

// openEditor({profile}) edits an existing profile; openEditor({registers}) starts a
// new profile from the explorer's draft.
export function openEditor({ profile = null, registers = null } = {}) {
	const source = registers || (profile ? profile.registers : []);
	ctx = { original: profile, rows: source.map((r) => ({ ...r, scaleRegister: r.scaleRegister ?? "" })) };
	const c = app.conn;
	$("edTitle").textContent = profile ? `Profil bearbeiten: ${profile.name}` : "Neues Profil speichern";
	$("edName").value = profile ? profile.name : "";
	$("edPort").value = profile ? profile.port : c.port;
	$("edUnit").value = profile ? profile.unit : c.unit;
	$("edFunction").value = String(profile ? profile.function : c.function);
	show($("edDelete"), !!profile);
	show($("edError"), false);
	renderRows();
	$("editor").classList.remove("hidden");
	$("edName").focus();
}

function renderRows() {
	$("edRegisters").innerHTML = ctx.rows.length
		? ctx.rows
				.map(
					(r, i) => `
<tr>
	<td><input class="mono" data-ed="address" data-i="${i}" value="${esc(r.address)}"></td>
	<td><input data-ed="name" data-i="${i}" value="${esc(r.name || "")}"></td>
	<td><select data-ed="type" data-i="${i}">${typeOptions(r.type)}</select></td>
	<td><select data-ed="endian" data-i="${i}">${endianOptions(r.endian)}</select></td>
	<td><input class="mono" data-ed="scale" data-i="${i}" value="${esc(r.scale ?? 1)}"></td>
	<td><input class="mono" data-ed="offset" data-i="${i}" value="${esc(r.offset ?? 0)}"></td>
	<td><input class="mono" data-ed="scaleRegister" data-i="${i}" value="${esc(r.scaleRegister ?? "")}" placeholder="–"></td>
	<td><input data-ed="unit" data-i="${i}" value="${esc(r.unit || "")}"></td>
	<td><button class="btn btn--ghost btn--sm" data-delrow="${i}" title="entfernen">✕</button></td>
</tr>`
				)
				.join("")
		: `<tr><td colspan="9" class="empty">Noch keine Register – „+ Register“ klicken.</td></tr>`;
}

function editorError(text) {
	$("edError").textContent = text;
	show($("edError"), true);
}

async function saveEditor() {
	const name = $("edName").value.trim();
	if (!name) return editorError("Bitte einen Namen eingeben.");
	const port = parseIntIn($("edPort").value, 1, 65535);
	const unit = parseIntIn($("edUnit").value, 0, 255);
	if (port === null) return editorError("Port muss zwischen 1 und 65535 liegen.");
	if (unit === null) return editorError("Unit-ID muss zwischen 0 und 255 liegen.");
	const original = ctx.original;
	const sameName = original && original.name === name;
	if (!sameName && app.profiles.some((p) => p.name === name) && !confirm(`Ein Profil „${name}“ gibt es schon. Überschreiben?`)) return;

	const profile = {
		name,
		ip: sameName ? original.ip || "" : "", // keep an IP that was put into the file by hand
		port,
		unit,
		function: Number($("edFunction").value),
		registers: normalizeDefs(ctx.rows),
	};
	const res = await api.saveProfile(profile);
	if (!res.success) return editorError(`Speichern fehlgeschlagen: ${res.error}`);
	$("editor").classList.add("hidden");
	await onSaved(name);
	setStatus("ok", `Profil „${name}“ gespeichert`);
}

async function deleteProfile() {
	const p = ctx.original;
	if (!p) return;
	if (!confirm(`Profil „${p.name}“ löschen?\n\nMitgelieferte Profile werden beim nächsten Start von wbecModbus wiederhergestellt.`)) return;
	const res = await api.deleteProfile(p.name);
	if (!res.success) return editorError(`Löschen fehlgeschlagen: ${res.error}`);
	$("editor").classList.add("hidden");
	await onSaved("");
	setStatus("ok", `Profil „${p.name}“ gelöscht`);
}
