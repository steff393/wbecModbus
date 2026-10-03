// Thin wrappers around the bridge's local HTTP API. Every Modbus request is
// logged (see log.js) and comes back in one normalized shape.

import { logEntry } from "./log.js";

async function request(url, body) {
	try {
		const res = await fetch(
			url,
			body === undefined
				? undefined
				: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
		);
		return await res.json();
	} catch (e) {
		return { success: false, errorKind: "bridge", error: String(e) };
	}
}

export function ping() {
	return request("/ping");
}

function connBody(conn) {
	const unit = Number(conn.unit);
	return {
		ip: String(conn.ip || "").trim(),
		port: Number(conn.port) || 502,
		unit: Number.isInteger(unit) ? unit : 1,
		function: Number(conn.function) || 3,
	};
}

function toData(raw) {
	const data = {};
	for (const [k, v] of Object.entries(raw || {})) data[Number(k)] = v;
	return data;
}

function preview(data, count) {
	const values = Object.values(data);
	return count <= 4 ? values.join(", ") : `${values.length} Werte`;
}

function failAll(ranges, info, connectMs = 0) {
	return {
		connectionError: info,
		connectMs,
		results: ranges.map((r) => ({ ...r, success: false, skipped: false, ...info, data: {} })),
		data: {},
	};
}

// Reads several register ranges [{start, count}] over one TCP connection.
// Returns { connectionError, connectMs, results: [{start, count, success, skipped,
// errorKind, exception, error, durationMs, data}], data } where data merges all
// successful ranges (address -> raw word). connectionError is set when the device was
// never reached; every result then carries that error.
// opts.log: "all" (default) | "errors" | "none"; opts.note is shown in the log.
export async function readBatch(conn, ranges, opts = {}) {
	const body = connBody(conn);
	const logMode = opts.log || "all";
	if (!body.ip) return failAll(ranges, { errorKind: "noip", error: "no ip" });

	const t0 = performance.now();
	const res = await request("/modbus/batch", { ...body, ranges });
	const elapsed = Math.round(performance.now() - t0);
	const time = Date.now();

	if (!res.success) {
		const info = { errorKind: res.errorKind || "other", error: res.error, exception: res.exception };
		if (logMode !== "none") {
			logEntry({ time, fc: body.function, label: `${body.ip}:${body.port} (Unit ${body.unit})`, ok: false, info, ms: elapsed, note: opts.note });
		}
		return failAll(ranges, info, res.connectMs || 0);
	}

	const data = {};
	let skipped = 0;
	const results = res.results.map((r) => {
		const out = {
			start: r.start,
			count: r.count,
			success: !!r.success,
			skipped: !!r.skipped,
			errorKind: r.skipped ? "skipped" : r.errorKind,
			exception: r.exception,
			error: r.error,
			durationMs: r.durationMs || 0,
			data: toData(r.data),
		};
		Object.assign(data, out.data);
		if (out.skipped) skipped++;
		else if (logMode === "all" || (logMode === "errors" && !out.success)) {
			logEntry({
				time, fc: body.function, start: out.start, count: out.count, ok: out.success,
				values: out.success ? preview(out.data, out.count) : undefined,
				info: out.success ? undefined : out, ms: out.durationMs, note: opts.note,
			});
		}
		return out;
	});
	if (skipped && logMode !== "none") {
		logEntry({ time, fc: body.function, label: `${skipped} weitere`, ok: false, info: { errorKind: "skipped" }, ms: 0, note: opts.note });
	}
	return { connectionError: null, connectMs: res.connectMs || 0, results, data };
}

export async function listProfiles() {
	const res = await request("/profiles");
	return res.success ? res.profiles : [];
}

export function saveProfile(profile) {
	return request("/profiles/save", profile);
}

export function deleteProfile(name) {
	return request("/profiles/delete", { name });
}
