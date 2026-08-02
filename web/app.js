let registers = {};

function getConfig() {
	return {
		ip: document.getElementById("ip").value,
		port: Number(document.getElementById("port").value),
		unit: Number(document.getElementById("unit").value),
		function: Number(document.getElementById("function").value)
	};
}


async function api(url, data) {
	let response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(data)
	});

	return await response.json();
}


function uint32BE(a, b) {
	return ((a << 16) | b) >>> 0;
}


function uint32LE(a, b) {
	return ((b << 16) | a) >>> 0;
}


function floatBE(a, b) {
	let buffer = new ArrayBuffer(4);
	let view = new DataView(buffer);

	view.setUint16(0, a);
	view.setUint16(2, b);

	return view.getFloat32(0);
}


function floatLE(a, b) {
	let buffer = new ArrayBuffer(4);
	let view = new DataView(buffer);

	view.setUint16(0, b);
	view.setUint16(2, a);

	return view.getFloat32(0);
}


function int16(value) {
	return value > 32767 ? value - 65536 : value;
}


async function readRegisters() {
	let request = {
		...getConfig(),
		start: Number(document.getElementById("start").value),
		count: Number(document.getElementById("count").value)
	};

	let result = await api("/modbus/read", request);

	if (!result.success) {
		alert(result.error);
		return;
	}

	registers = result.data;
	showTable(registers);
}


async function scanRegisters() {
	let request = {
		...getConfig(),
		from: Number(document.getElementById("scanFrom").value),
		to: Number(document.getElementById("scanTo").value)
	};

	let result = await api("/modbus/scan", request);

	if (!result.success) {
		alert(result.error);
		return;
	}

	registers = result.data;
	showTable(registers);
}


function showTable(data) {
	let html = "";

	let addresses = Object.keys(data)
		.map(Number)
		.sort((a, b) => a - b);


	for (let i = 0; i < addresses.length; i++) {
		let address = addresses[i];
		let value = data[address];

		let next = data[address + 1];

		let u32be = "";
		let u32le = "";
		let fbe = "";
		let fle = "";

		if (next !== undefined) {
			u32be = uint32BE(value, next);
			u32le = uint32LE(value, next);
			fbe = floatBE(value, next).toFixed(4);
			fle = floatLE(value, next).toFixed(4);
		}

		html += `
<tr>
<td>${address}</td>
<td>0x${value.toString(16).padStart(4, "0").toUpperCase()}</td>
<td>${value}</td>
<td>${int16(value)}</td>
<td>${u32be}</td>
<td>${u32le}</td>
<td>${fbe}</td>
<td>${fle}</td>
</tr>`;
	}

	document.getElementById("table").innerHTML = html;
}


function searchRegisters() {
	let target = Number(
		document.getElementById("searchValue").value
	);

	let result = [];

	let addresses = Object.keys(registers)
		.map(Number)
		.sort((a, b) => a - b);


	for (let i = 0; i < addresses.length; i++) {
		let address = addresses[i];
		let value = registers[address];
		let next = registers[address + 1];


		if (value === target) {
			result.push({
				address,
				type: "uint16",
				value
			});
		}


		if (int16(value) === target) {
			result.push({
				address,
				type: "int16",
				value: int16(value)
			});
		}


		if (next !== undefined) {
			let u32be = uint32BE(value, next);
			let u32le = uint32LE(value, next);

			if (u32be === target) {
				result.push({
					address,
					type: "uint32 BE",
					value: u32be
				});
			}

			if (u32le === target) {
				result.push({
					address,
					type: "uint32 LE",
					value: u32le
				});
			}


			let fbe = floatBE(value, next);

			if (Math.abs(fbe - target) < 0.0001) {
				result.push({
					address,
					type: "float BE",
					value: fbe
				});
			}


			let fle = floatLE(value, next);

			if (Math.abs(fle - target) < 0.0001) {
				result.push({
					address,
					type: "float LE",
					value: fle
				});
			}
		}
	}

	showSearchResults(result);
}


function showSearchResults(result) {
	let html = "";

	for (let item of result) {
		html += `
<tr>
<td>${item.address}</td>
<td>${item.type}</td>
<td>${item.value}</td>
</tr>`;
	}

	document.getElementById("searchTable").innerHTML = html;
}