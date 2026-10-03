// Entry point: wires the connection bar, the three modes ("Gerät prüfen",
// "Fehlersuche", "Register erforschen"), the request log and the help dialog.

import * as api from "./api.js";
import { $ } from "./util.js";
import { app, setStatus, stopPoller } from "./state.js";
import { load, save, clearAll } from "./storage.js";
import { initLog } from "./log.js";
import { initConnection, reloadProfiles } from "./connection.js";
import { initCheck } from "./check.js";
import { initDiagnose } from "./diagnose.js";
import { initExplore, exploreProbeAddress } from "./explore.js";
import { initEditor, openEditor } from "./editor.js";

const MODES = ["check", "diagnose", "explore"];

function setMode(mode) {
	if (!MODES.includes(mode)) mode = "check";
	if (mode !== app.mode) stopPoller(); // live reading belongs to the mode that started it
	app.mode = mode;
	for (const m of MODES) {
		$("mode-" + m).classList.toggle("hidden", m !== mode);
		const tab = document.querySelector(`.mode[data-mode="${m}"]`);
		tab.classList.toggle("mode--on", m === mode);
		tab.setAttribute("aria-selected", String(m === mode));
	}
	save("mode", mode);
}

function initHelp() {
	const help = $("help");
	const close = () => help.classList.add("hidden");
	$("btnHelp").addEventListener("click", () => help.classList.remove("hidden"));
	$("helpClose").addEventListener("click", close);
	$("helpClose2").addEventListener("click", close);
	help.addEventListener("click", (e) => e.target === help && close());
	$("btnClearStorage").addEventListener("click", () => {
		const question =
			"Alle in diesem Browser gespeicherten Einstellungen löschen (IP-Adressen, Verbindungen, Beobachtungsliste, Profil-Entwurf)?\n\nDie Seite lädt danach neu – so wie beim ersten Start.";
		if (!confirm(question)) return;
		clearAll();
		location.reload();
	});

	// Escape closes whatever dialog is open.
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape") return;
		for (const id of ["help", "editor", "details"]) $(id).classList.add("hidden");
	});
}

async function boot() {
	initLog();
	initHelp();
	initEditor({ saved: (name) => reloadProfiles(name) });
	initConnection({ probeFallback: exploreProbeAddress, onEditProfile: (profile) => openEditor({ profile }) });
	initCheck({ gotoMode: setMode });
	initDiagnose();
	initExplore({ openEditor });

	for (const tab of document.querySelectorAll(".mode")) {
		tab.addEventListener("click", () => setMode(tab.dataset.mode));
	}
	app.mode = load("mode", "check");
	setMode(app.mode);

	const info = await api.ping();
	if (info.version) {
		app.version = info.version;
		$("version").textContent = "v" + info.version;
		setStatus("idle", "Bereit");
	} else {
		setStatus("err", "wbecModbus nicht erreichbar – läuft die EXE noch?");
	}
	await reloadProfiles();
}

boot();
