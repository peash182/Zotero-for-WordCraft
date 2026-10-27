/* WordCraft Connector for Zotero 7+ — bootstrap entry point */

function install() {}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	Services.scriptloader.loadSubScript(rootURI + "content/core.js");
	Services.scriptloader.loadSubScript(rootURI + "content/plugin.js");
	WordCraftZotero.init({ id, version, rootURI });
	// Windows that are already open don't get onMainWindowLoad
	Zotero.getMainWindows().forEach((win) => onMainWindowLoad({ window: win }));
}

function onMainWindowLoad({ window }) {
	WordCraftZotero.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	WordCraftZotero.removeFromWindow(window);
}

function shutdown() {
	if (typeof WordCraftZotero !== "undefined") {
		Zotero.getMainWindows().forEach((win) => WordCraftZotero.removeFromWindow(win));
	}
}

function uninstall() {}
