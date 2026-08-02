function getSettings()
{

	return {

		ip:
		document.getElementById("ip").value,

		port:
		Number(
			document.getElementById("port").value
		),

		unit:
		Number(
			document.getElementById("unit").value
		),

		function:
		Number(
			document.getElementById("function").value
		)

	};

}



async function readRegisters()
{

	let cfg=getSettings();


	let request =
	{

		...cfg,

		start:
		Number(
			document.getElementById("start").value
		),

		count:
		Number(
			document.getElementById("count").value
		)

	};



	let response =
	await fetch(
		"/modbus/read",
		{
			method:"POST",

			headers:
			{
				"Content-Type":
				"application/json"
			},

			body:
			JSON.stringify(request)
		}
	);



	let json =
	await response.json();



	if(!json.success)
	{

		alert(json.error);
		return;

	}



	let values=[];


	for(let key in json.data)
	{
		values.push(
			json.data[key]
		);
	}



	showRegisters(
		request.start,
		values
	);

}





async function scanRegisters()
{

	let cfg=getSettings();


	let request =
	{

		...cfg,

		from:
		Number(
			document.getElementById("scanFrom").value
		),

		to:
		Number(
			document.getElementById("scanTo").value
		)

	};



	let response =
	await fetch(
		"/modbus/scan",
		{

			method:"POST",

			headers:
			{
				"Content-Type":
				"application/json"
			},

			body:
			JSON.stringify(request)

		}
	);



	let json =
	await response.json();



	if(!json.success)
	{

		alert(json.error);
		return;

	}



	let addresses =
	Object.keys(json.data)
	.map(Number)
	.sort(
		(a,b)=>a-b
	);



	let values =
	addresses.map(
		a=>json.data[a]
	);



	scannedRegisters = json.data;


	showRegisters(
			addresses[0],
			values
	);

}





function showRegisters(start, values)
{

	let html="";


	for(let i=0;i<values.length;i++)
	{


		let value =
		values[i];


		let hex =
		"0x"+
		value
		.toString(16)
		.padStart(4,"0")
		.toUpperCase();



		let int16 =
		value>32767 ?
		value-65536 :
		value;



		let uint32BE="";
		let uint32LE="";
		let floatBE="";
		let floatLE="";



		if(i+1<values.length)
		{

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
			view.getUint32(
				0,
				false
			);



			floatBE =
			view.getFloat32(
				0,
				false
			).toFixed(4);




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
			view.getUint32(
				0,
				false
			);



			floatLE =
			view.getFloat32(
				0,
				false
			).toFixed(4);

		}



		html +=
		`

<tr>

<td>${start+i}</td>

<td>${hex}</td>

<td>${value}</td>

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

let scannedRegisters = {};

function searchRegisters()
{

	let target =
	Number(
		document.getElementById(
			"searchValue"
		).value
	);



	let result=[];


	let addresses =
	Object.keys(scannedRegisters)
	.map(Number)
	.sort(
		(a,b)=>a-b
	);



	for(let i=0;i<addresses.length;i++)
	{


		let addr =
		addresses[i];


		let value =
		scannedRegisters[addr];



		// uint16

		if(value === target)
		{

			result.push({
				address:addr,
				type:"uint16",
				value:value
			});

		}



		// int16

		let signed =
		value > 32767 ?
		value-65536 :
		value;



		if(signed === target)
		{

			result.push({
				address:addr,
				type:"int16",
				value:signed
			});

		}



		// 32 Bit Kombinationen

		if(i+1 < addresses.length)
		{


			let next =
			scannedRegisters[
				addresses[i+1]
			];



			let buffer =
			new ArrayBuffer(4);


			let view =
			new DataView(buffer);



			view.setUint16(
				0,
				value,
				false
			);


			view.setUint16(
				2,
				next,
				false
			);



			let uint32 =
			view.getUint32(
				0,
				false
			);



			if(uint32 === target)
			{

				result.push({

					address:addr,

					type:"uint32 BE",

					value:uint32

				});

			}



			let float =
			view.getFloat32(
				0,
				false
			);



			if(
				Math.abs(float-target)
				<0.0001
			)
			{

				result.push({

					address:addr,

					type:"float BE",

					value:float

				});

			}


		}

	}



	showSearchResults(result);

}




function showSearchResults(results)
{

	let html="";


	for(let r of results)
	{

		html += `

<tr>

<td>${r.address}</td>

<td>${r.type}</td>

<td>${r.value}</td>

</tr>

`;

	}


	document.getElementById(
		"searchTable"
	)
	.innerHTML=html;

}