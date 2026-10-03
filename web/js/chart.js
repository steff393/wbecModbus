// Tiny dependency-free SVG charts. The EXE must work offline and stay a single
// file, so there is deliberately no chart library.

import { fmtNum, clock } from "./util.js";

// Rolling value history per series key: [{t, v}], v === null marks a failed read.
export function createHistory(maxPoints = 720) {
	const series = new Map();
	return {
		push(key, t, v) {
			let points = series.get(key);
			if (!points) series.set(key, (points = []));
			points.push({ t, v });
			if (points.length > maxPoints) points.splice(0, points.length - maxPoints);
		},
		get(key) {
			return series.get(key) || [];
		},
		delete(key) {
			series.delete(key);
		},
		clear() {
			series.clear();
		},
	};
}

function finiteValues(points) {
	return points.map((p) => p.v).filter((v) => Number.isFinite(v));
}

// SVG path through the points; failed reads (non-finite v) break the line.
function linePath(points, sx, sy) {
	let d = "";
	let pen = false;
	points.forEach((p, i) => {
		if (!Number.isFinite(p.v)) {
			pen = false;
			return;
		}
		d += `${pen ? "L" : "M"}${sx(p, i).toFixed(1)},${sy(p.v).toFixed(1)}`;
		pen = true;
	});
	return d;
}

function extent(values) {
	let min = Math.min(...values);
	let max = Math.max(...values);
	if (min === max) {
		const pad = Math.abs(min) * 0.05 || 1;
		min -= pad;
		max += pad;
	}
	return [min, max];
}

// Small trend line for the value cards (x = sample index, stretched to fit).
export function sparkline(svg, points) {
	const w = 200;
	const h = 32;
	svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
	svg.setAttribute("preserveAspectRatio", "none");
	const values = finiteValues(points);
	if (values.length < 2) {
		svg.innerHTML = "";
		return;
	}
	const [min, max] = extent(values);
	const n = points.length - 1;
	const d = linePath(points, (_, i) => (i / n) * w, (v) => h - 2 - ((v - min) / (max - min)) * (h - 4));
	svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
}

// Line chart over time with min/mid/max labels and a hover readout.
export function renderChart(el, points, { unit = "", height = 140 } = {}) {
	const values = finiteValues(points);
	if (values.length === 0) {
		el._chart = null;
		el.innerHTML = `<div class="chart__empty">Noch kein Verlauf – er entsteht beim wiederholten Lesen.</div>`;
		return;
	}

	const width = Math.max(240, el.clientWidth || 600);
	const pad = { l: 70, r: 12, t: 10, b: 22 };
	const [vMin, vMax] = extent(values);
	const t0 = points[0].t;
	const t1 = points[points.length - 1].t;
	const span = Math.max(1, t1 - t0);
	const sx = (p) => pad.l + ((p.t - t0) / span) * (width - pad.l - pad.r);
	const sy = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * (height - pad.t - pad.b);

	const grid = [vMax, (vMin + vMax) / 2, vMin]
		.map((v) => {
			const y = sy(v).toFixed(1);
			return `<line class="chart__grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${fmtNum(v)}</text>`;
		})
		.join("");
	const last = [...points].reverse().find((p) => Number.isFinite(p.v));

	el.innerHTML =
		`<svg class="chart__svg" width="${width}" height="${height}">${grid}` +
		`<text x="${pad.l}" y="${height - 6}">${clock(t0)}</text>` +
		`<text x="${width - pad.r}" y="${height - 6}" text-anchor="end">${clock(t1)}</text>` +
		`<path class="chart__line" d="${linePath(points, sx, sy)}"/>` +
		`<circle class="chart__dot" cx="${sx(last).toFixed(1)}" cy="${sy(last.v).toFixed(1)}" r="3"/>` +
		`<line class="chart__cursor hidden" y1="${pad.t}" y2="${height - pad.b}"/></svg>` +
		`<div class="chart__tip hidden"></div>`;
	el._chart = { points, sx, width, unit };
	wireHover(el);
}

function wireHover(el) {
	if (el._hoverWired) return;
	el._hoverWired = true;

	el.addEventListener("mousemove", (e) => {
		const c = el._chart;
		const svg = el.querySelector("svg");
		if (!c || !svg) return;
		const x = e.clientX - svg.getBoundingClientRect().left;
		let best = null;
		let bestDx = Infinity;
		for (const p of c.points) {
			if (!Number.isFinite(p.v)) continue;
			const dx = Math.abs(c.sx(p) - x);
			if (dx < bestDx) {
				bestDx = dx;
				best = p;
			}
		}
		if (!best) return;
		const px = c.sx(best);
		const cursor = svg.querySelector(".chart__cursor");
		cursor.setAttribute("x1", px);
		cursor.setAttribute("x2", px);
		cursor.classList.remove("hidden");
		const tip = el.querySelector(".chart__tip");
		tip.textContent = `${fmtNum(best.v)} ${c.unit} · ${clock(best.t)}`.replace("  ", " ");
		tip.classList.remove("hidden");
		tip.style.left = Math.max(0, Math.min(px + 8, c.width - tip.offsetWidth - 4)) + "px";
	});

	el.addEventListener("mouseleave", () => {
		el.querySelector(".chart__cursor")?.classList.add("hidden");
		el.querySelector(".chart__tip")?.classList.add("hidden");
	});
}
