// Reads register definitions (profile entries, watch entries) in one batch and
// evaluates them. Shared by "Gerät prüfen", "Fehlersuche" and the explorer watch.

import { readBatch } from "./api.js";
import { defWidth, hasScaleRegister, evaluateDef } from "./interpret.js";

// Returns { time, connError, items, regs, ok, failed } with one item per def:
// { def, status: "ok" | "error" | "skipped", value, raw, sf, warning, error }.
export async function readDefs(conn, defs, opts = {}) {
	const ranges = [];
	const index = new Map();
	const need = (start, count) => {
		const key = `${start}:${count}`;
		if (!index.has(key)) {
			index.set(key, ranges.length);
			ranges.push({ start, count });
		}
		return index.get(key);
	};
	const plan = defs.map((def) => ({
		main: need(Number(def.address), defWidth(def)),
		sf: hasScaleRegister(def) ? need(Number(def.scaleRegister), 1) : null,
	}));

	const empty = { value: null, raw: null, sf: null, warning: null };
	if (ranges.length === 0) return { time: Date.now(), connError: null, items: [], regs: {}, ok: 0, failed: 0 };

	const res = await readBatch(conn, ranges, opts);
	const items = defs.map((def, i) => {
		const main = res.results[plan[i].main];
		const sf = plan[i].sf === null ? null : res.results[plan[i].sf];
		const failed = !main.success ? main : sf && !sf.success ? sf : null;
		if (failed) return { def, status: failed.skipped ? "skipped" : "error", ...empty, error: failed, sfFailed: failed === sf };
		return { def, status: "ok", ...evaluateDef(def, res.data), error: null };
	});

	const ok = items.filter((it) => it.status === "ok").length;
	return { time: Date.now(), connError: res.connectionError, items, regs: res.data, ok, failed: items.length - ok };
}
