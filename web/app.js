async function readRegisters() {


	let request = {

		ip:
		document.getElementById("ip").value,

		unit:
		Number(document.getElementById("unit").value),

		function:
		Number(document.getElementById("function").value),

		start:
		Number(document.getElementById("start").value),

		count:
		Number(document.getElementById("count").value)

	};


	let response =
		await fetch(
			"/modbus/read",
			{
				method:"POST",
				headers:{
					"Content-Type":
					"application/json"
				},
				body:
				JSON.stringify(request)
			}
		);


	let data =
		await response.json();


	if (!data.success) {

		alert(data.error);
		return;
	}


	showRegisters(
		request.start,
		data.registers
	);

}



function showRegisters(start, values) {


	let html="";


	for(let i=0;i<values.length;i++) {


		let addr =
			start+i;


		let hex =
			"0x"+
			values[i]
			.toString(16)
			.padStart(4,"0")
			.toUpperCase();



		let int16 =
			values[i] > 32767 ?
			values[i]-65536 :
			values[i];



		let uint32 = "";

		let uint32le = "";


		if(i+1 < values.length) {


			let buf =
			new ArrayBuffer(4);


			let dv =
			new DataView(buf);


			dv.setUint16(
				0,
				values[i]
			);

			dv.setUint16(
				2,
				values[i+1]
			);



			uint32 =
			dv.getUint32(0);



			dv.setUint16(
				0,
				values[i+1]
			);

			dv.setUint16(
				2,
				values[i]
			);


			uint32le =
			dv.getUint32(0);
		}


		html +=
		`
		<tr>
		<td>${addr}</td>
		<td>${hex}</td>
		<td>${values[i]}</td>
		<td>${int16}</td>
		<td>${uint32}</td>
		<td>${uint32le}</td>
		</tr>
		`;

	}


	document.getElementById("table").innerHTML =
	html;

}