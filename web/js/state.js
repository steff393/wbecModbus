// Shared application state, a tiny event bus, the single cyclic reader and the
// global status indicator.

import { $ } from "./util.js";

export const app = {
	version: "",
	profiles: [],
	profile: null, // active profile ("Wechselrichter-Typ") or null
	conn: { ip: "", port: 502, unit: 1, function: 3 },
	mode: "check",
};

// Events: "profile" (active profile changed), "conn" (connection settings changed).
const listeners = new Map();

export function on(event, fn) {
	if (!listeners.has(event)) listeners.set(event, []);
	listeners.get(event).push(fn);
}

export function emit(event, payload) {
	for (const fn of listeners.get(event) || []) fn(payload);
}

// Only one cyclic reader runs at a time (live check or explorer watch), so the
// device is never polled twice in parallel. A tick is skipped while the previous one
// is still waiting for the device.
let poller = null;

export function startPoller(owner, intervalMs, tick, onStop) {
	stopPoller();
	let busy = false;
	const run = async () => {
		if (busy) return;
		busy = true;
		try {
			await tick();
		} finally {
			busy = false;
		}
	};
	poller = { owner, timer: setInterval(run, intervalMs), onStop };
	run();
}

// Stops the running poller (only if it belongs to `owner`, when given).
export function stopPoller(owner) {
	if (!poller || (owner && poller.owner !== owner)) return;
	clearInterval(poller.timer);
	const { onStop } = poller;
	poller = null;
	if (onStop) onStop();
}

export function pollerOwner() {
	return poller ? poller.owner : null;
}

export function setStatus(kind, text) {
	const el = $("status");
	el.className = "status status--" + kind; // ok | warn | err | busy | idle
	el.querySelector(".status__text").textContent = text;
}
