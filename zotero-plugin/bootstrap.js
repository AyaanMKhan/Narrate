/**
 * Narrate for Zotero — bootstrap.js
 *
 * Zotero 7 plugins are "bootstrapped extensions": Zotero loads this file
 * directly (no bundler, no build step) into a privileged sandbox and calls
 * these lifecycle functions itself. `Zotero`, `Services`, and the reason
 * constants below (APP_STARTUP, APP_SHUTDOWN, ADDON_DISABLE, ...) are
 * injected as globals into that sandbox — see Zotero's own
 * chrome/content/zotero/xpcom/plugins.js (_loadScope/_callMethod), which is
 * the actual source of the lifecycle contract used here:
 *   func.call(scope, { id, version, rootURI, ...extraParams }, reason)
 *
 * Docs:
 * https://www.zotero.org/support/dev/zotero_7_for_developers
 * https://www.zotero.org/support/dev/client_coding/plugin_development
 *
 * Reference implementation this shape was checked against:
 * https://github.com/zotero/make-it-red (src-2.0/bootstrap.js)
 */

var Narrate;

function log(msg) {
	Zotero.debug('Narrate: ' + msg);
}

function install(data, reason) {
	log('install');
}

async function startup({ id, version, rootURI }, reason) {
	log('startup');

	Services.scriptloader.loadSubScript(rootURI + 'narrate.js');
	Narrate.init({ id, version, rootURI });
	Narrate.addToReader();
}

function onMainWindowLoad({ window }, reason) {
	// No per-window UI in v1. The reader popup hook registered in startup()
	// is attached to Zotero.Reader, which is a single global object shared
	// across all main windows and reader tabs — it doesn't need to be
	// re-registered per window. This stub exists so the plugin follows the
	// standard Zotero 7 bootstrap lifecycle (install/startup/shutdown +
	// onMainWindowLoad/onMainWindowUnload) in case a future version adds
	// window-level UI (e.g. a menu item or toolbar button).
}

function onMainWindowUnload({ window }, reason) {
	// See onMainWindowLoad.
}

function shutdown(data, reason) {
	log('shutdown');

	if (reason === APP_SHUTDOWN) {
		// Zotero itself is quitting — nothing to clean up.
		return;
	}

	if (Narrate) {
		Narrate.removeFromReader();
	}
	Narrate = undefined;
}

function uninstall(data, reason) {
	log('uninstall');
}
