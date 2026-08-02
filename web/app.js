async function readRegisters() {


	let request = {

		ip:
		document.getElementById("ip").value,

		port:
		Number(document.getElementById("port").value),

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



	if(!data.success){

		alert(data.error);
		return;

	}


	showRegisters(
		request.start,
		data.registers
	);

}



function showRegisters(start, values){


	let html="";


	for(let i=0;i<values.length;i++){


		let addr=start+i;


		let hex =
		"0x"+
		values[i]
		.toString(16)
		.padStart(4,"0")
		.toUpperCase();



		let int16 =
		values[i]>32767 ?
		values[i]-65536 :
		values[i];



		let uint32BE="";
		let uint32LE="";
		let floatBE="";
		let floatLE="";


		if(i+1<values.length){


			let buffer =
			new ArrayBuffer(4);


			let view =
			new DataView(buffer);



			view.setUint16(
				0,
				values[i],
				false
			);

			view.setUint16(
				2,
				values[i+1],
				false
			);



			uint32BE =
			view.getUint32(0,false);



			floatBE =
			view.getFloat32(0,false)
			.toFixed(4);



			view.setUint16(
				0,
				values[i+1],
				false
			);

			view.setUint16(
				2,
				values[i],
				false
			);



			uint32LE =
			view.getUint32(0,false);



			floatLE =
			view.getFloat32(0,false)
			.toFixed(4);

		}



		html += `

<tr>

<td>${addr}</td>

<td>${hex}</td>

<td>${values[i]}</td>

<td>${int16}</td>

<td>${uint32BE}</td>

<td>${uint32LE}</td>

<td>${floatBE}</td>

<td>${floatLE}</td>

</tr>

`;

	}


	document.getElementById("table")
	.innerHTML=html;

}