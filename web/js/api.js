// Thin wrappers around the bridge's local HTTP API.

async function post(url, body) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json();
}

async function get(url) {
	const res = await fetch(url);
	return res.json();
}

export function ping() {
	return get("/ping");
}

// config = {ip, port, unit, function}
export function readRegisters(config, start, count) {
	return post("/modbus/read", { ...config, start, count });
}

export function scanRegisters(config, from, to) {
	return post("/modbus/scan", { ...config, from, to });
}

export async function listProfiles() {
	const res = await get("/profiles");
	return res.success ? res.profiles : [];
}

export function saveProfile(profile) {
	return post("/profiles/save", profile);
}

export function deleteProfile(name) {
	return post("/profiles/delete", { name });
}
