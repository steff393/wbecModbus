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

// Decode one profile register definition to its physical value, or null when the
// backing register(s) are not present in `regs`.
export function interpretDef(def, regs) {
	const a = regs[def.address];
	if (a === undefined) return null;
	const b = regs[def.address + 1];
	const little = def.endian === "little";
	const scale = Number.isFinite(Number(def.scale)) ? Number(def.scale) : 1;
	const offset = Number.isFinite(Number(def.offset)) ? Number(def.offset) : 0;

	let raw;
	switch (def.type) {
		case "uint16":
			raw = a;
			break;
		case "int16":
			raw = toInt16(a);
			break;
		case "uint32":
			if (b === undefined) return null;
			raw = little ? toUint32LE(a, b) : toUint32BE(a, b);
			break;
		case "int32":
			if (b === undefined) return null;
			raw = little ? toInt32LE(a, b) : toInt32BE(a, b);
			break;
		case "float32":
			if (b === undefined) return null;
			raw = little ? toFloatLE(a, b) : toFloatBE(a, b);
			break;
		default:
			raw = a;
	}
	return raw * scale + offset;
}

// How many registers a definition consumes (2 for 32-bit types, else 1).
export function defWidth(def) {
	return def.type === "uint16" || def.type === "int16" ? 1 : 2;
}
