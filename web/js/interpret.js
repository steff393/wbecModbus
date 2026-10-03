// Pure value-interpretation helpers. Raw registers are always 16-bit words read
// big-endian off the wire; everything below reinterprets them client-side.

export function toInt16(v) {
	return v > 0x7fff ? v - 0x10000 : v;
}

export function toUint32BE(hi, lo) {
	return ((hi << 16) | lo) >>> 0;
}

export function toUint32LE(hi, lo) {
	return ((lo << 16) | hi) >>> 0;
}

export function toInt32BE(hi, lo) {
	const u = toUint32BE(hi, lo);
	return u > 0x7fffffff ? u - 0x100000000 : u;
}

export function toInt32LE(hi, lo) {
	const u = toUint32LE(hi, lo);
	return u > 0x7fffffff ? u - 0x100000000 : u;
}

function float32(wordHi, wordLo) {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint16(0, wordHi);
	view.setUint16(2, wordLo);
	return view.getFloat32(0); // big-endian read
}

export function toFloatBE(a, b) {
	return float32(a, b);
}

export function toFloatLE(a, b) {
	return float32(b, a);
}

export function toHex16(v) {
	return "0x" + v.toString(16).toUpperCase().padStart(4, "0");
}

export function toBin16(v) {
	const s = v.toString(2).padStart(16, "0");
	return s.slice(0, 8) + " " + s.slice(8);
}

export function toAscii(v) {
	const chars = [v >> 8, v & 0xff].map((c) =>
		c >= 32 && c < 127 ? String.fromCharCode(c) : "·"
	);
	return chars.join("");
}

// Format a float compactly without a long tail of decimals.
export function fmtFloat(n) {
	if (!isFinite(n)) return String(n);
	if (Math.abs(n) >= 1e9 || (n !== 0 && Math.abs(n) < 1e-4)) return n.toExponential(3);
	return Number(n.toFixed(4)).toString();
}

// Every numeric reading of a register (and its successor for 32-bit types). The
// explorer offers these for search, details and "ins Profil".
export const INTERPRETATIONS = [
	{ label: "uint16", type: "uint16", endian: "big" },
	{ label: "int16", type: "int16", endian: "big" },
	{ label: "uint32 BE", type: "uint32", endian: "big" },
	{ label: "uint32 LE", type: "uint32", endian: "little" },
	{ label: "int32 BE", type: "int32", endian: "big" },
	{ label: "int32 LE", type: "int32", endian: "little" },
	{ label: "float BE", type: "float32", endian: "big" },
	{ label: "float LE", type: "float32", endian: "little" },
];

export function typeWidth(type) {
	return type === "uint16" || type === "int16" ? 1 : 2;
}

// How many registers a definition consumes (2 for 32-bit types, else 1).
export function defWidth(def) {
	return typeWidth(def.type);
}

// "int16", "uint32", "float32 LE" …
export function typeLabel(def) {
	return def.type + (typeWidth(def.type) === 2 && def.endian === "little" ? " LE" : "");
}

// Unscaled value of `type` from word `a` (+ `b` for 32-bit), or null if a word is missing.
export function rawValue(type, endian, a, b) {
	if (a === undefined) return null;
	const little = endian === "little";
	switch (type) {
		case "int16":
			return toInt16(a);
		case "uint32":
			return b === undefined ? null : little ? toUint32LE(a, b) : toUint32BE(a, b);
		case "int32":
			return b === undefined ? null : little ? toInt32LE(a, b) : toInt32BE(a, b);
		case "float32":
			return b === undefined ? null : little ? toFloatLE(a, b) : toFloatBE(a, b);
		default:
			return a;
	}
}

// Every interpretation of the register at `addr` (and its successor for 32-bit
// types). Returns [{label, value}] for the tooltip.
export function allInterpretations(addr, regs) {
	const a = regs[addr];
	if (a === undefined) return [];

	const rows = [
		{ label: "hex", value: toHex16(a) },
		{ label: "binary", value: toBin16(a) },
		{ label: "uint16", value: a },
		{ label: "int16", value: toInt16(a) },
		{ label: "ascii", value: toAscii(a) },
	];

	const b = regs[addr + 1];
	if (b !== undefined) {
		rows.push(
			{ label: "uint32 BE", value: toUint32BE(a, b) },
			{ label: "uint32 LE", value: toUint32LE(a, b) },
			{ label: "int32 BE", value: toInt32BE(a, b) },
			{ label: "int32 LE", value: toInt32LE(a, b) },
			{ label: "float BE", value: fmtFloat(toFloatBE(a, b)) },
			{ label: "float LE", value: fmtFloat(toFloatLE(a, b)) }
		);
	}
	return rows;
}

export function hasScaleRegister(def) {
	return def.scaleRegister !== undefined && def.scaleRegister !== null && def.scaleRegister !== "";
}

function numberOr(value, fallback) {
	const n = Number(value);
	return value !== "" && value !== null && value !== undefined && Number.isFinite(n) ? n : fallback;
}

// SunSpec and others mark "not implemented / not available" with these raw values.
const NOT_AVAILABLE = { uint16: 0xffff, int16: -0x8000, uint32: 0xffffffff, int32: -0x80000000 };

// Rough sanity ranges per unit — only to warn, never to hide a value.
const UNIT_LIMITS = {
	V: [-1500, 1500],
	A: [-1000, 1000],
	W: [-250000, 250000],
	kW: [-250, 250],
	VA: [-250000, 250000],
	var: [-250000, 250000],
	Hz: [0, 70],
	"%": [0, 100],
	"°C": [-50, 150],
	Wh: [0, Infinity],
	kWh: [0, Infinity],
};

// Warning text for a suspicious value, or null.
export function plausibility(def, raw, value) {
	if (NOT_AVAILABLE[def.type] === raw) return "Gerät meldet „nicht verfügbar“ (Kennwert für fehlende Daten)";
	if (!Number.isFinite(value)) return "Kein gültiger Zahlenwert – Datentyp oder Wortreihenfolge prüfen";
	const limit = UNIT_LIMITS[String(def.unit || "").trim()];
	if (limit && (value < limit[0] || value > limit[1])) {
		return `Wert wirkt unplausibel für ${def.unit} – Skalierung oder Datentyp prüfen`;
	}
	return null;
}

// Decode one profile register definition:
// physical = raw * scale * 10^SF + offset, SF read from def.scaleRegister (SunSpec).
// Returns { value, raw, sf, warning }; value is null when a needed register is missing
// or the scale factor is marked "not available".
export function evaluateDef(def, regs) {
	const raw = rawValue(def.type, def.endian, regs[def.address], regs[def.address + 1]);
	if (raw === null) return { value: null, raw: null, sf: null, warning: null };

	let sf = null;
	if (hasScaleRegister(def)) {
		const word = regs[Number(def.scaleRegister)];
		if (word === undefined) return { value: null, raw, sf: null, warning: null };
		sf = toInt16(word);
		if (sf === -0x8000) {
			return { value: null, raw, sf, warning: "Skalierungsfaktor meldet „nicht verfügbar“ (0x8000)" };
		}
	}

	const value = raw * numberOr(def.scale, 1) * Math.pow(10, sf ?? 0) + numberOr(def.offset, 0);
	return { value, raw, sf, warning: plausibility(def, raw, value) };
}

// Physical value only (null when not computable) — used by the explorer tooltip.
export function interpretDef(def, regs) {
	return evaluateDef(def, regs).value;
}
