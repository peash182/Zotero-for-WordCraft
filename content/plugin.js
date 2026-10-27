/* WordCraft Connector — Zotero-side logic (runs in Zotero's privileged scope). */

var WordCraftZotero = {
	id: null,
	version: null,
	rootURI: null,
	_menuIDs: [],
	_listeners: [],
	_client: null,

	init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this._client = null;
	},

	log(msg) {
		Zotero.debug("WordCraft Connector: " + msg);
	},

	// ---------- preferences ----------

	pref(name, fallback) {
		var v = Zotero.Prefs.get("extensions.wordcraft." + name, true);
		return v === undefined || v === null || v === "" ? fallback : v;
	},

	port() {
		return Number(this.pref("port", 7981));
	},

	styleID() {
		var s = this.pref("style", "");
		if (!s) s = WordCraftCore.parseQuickCopySetting(Zotero.Prefs.get("export.quickCopy.setting"));
		return s || "http://www.zotero.org/styles/apa";
	},

	locale() {
		return Zotero.Prefs.get("export.quickCopy.locale") || Zotero.locale || "en-US";
	},

	// ---------- connection to WordCraft ----------

	client() {
		if (!this._client) {
			var win = Zotero.getMainWindow();
			this._client = new WordCraftCore.Client({
				connect: () => this._connect(),
				getKey: () => this._getKey(),
				setTimeout: win.setTimeout.bind(win),
				clearTimeout: win.clearTimeout.bind(win),
			});
		}
		return this._client;
	},

	async _getKey() {
		var override = this.pref("key", "");
		if (override) return override;
		if (Services.env.exists("WORDCRAFT_CONTROL_KEY")) return Services.env.get("WORDCRAFT_CONTROL_KEY");

		var home = Services.dirsvc.get("Home", Components.interfaces.nsIFile).path;
		var env = {
			APPDATA: Services.env.exists("APPDATA") ? Services.env.get("APPDATA") : "",
			XDG_CONFIG_HOME: Services.env.exists("XDG_CONFIG_HOME") ? Services.env.get("XDG_CONFIG_HOME") : "",
		};
		var platform = Zotero.isMac ? "mac" : Zotero.isWin ? "win" : "linux";
		var dir = PathUtils.join(...WordCraftCore.settingsDirParts(platform, env, home));
		var port = this.port();

		var exact = PathUtils.join(dir, "control-key.local-" + port);
		if (await IOUtils.exists(exact)) return (await IOUtils.readUTF8(exact)).trim();

		// Fall back to the only control-key file in the folder, if there is exactly one.
		var children = [];
		try { children = await IOUtils.getChildren(dir); } catch (e) { /* folder missing */ }
		var keys = children.filter((p) => PathUtils.filename(p).startsWith("control-key."));
		if (keys.length === 1) return (await IOUtils.readUTF8(keys[0])).trim();

		throw new Error(
			"Couldn't find WordCraft's control key. Start WordCraft with --control " + port +
			" (or set extensions.wordcraft.key)."
		);
	},

	// Raw TCP to 127.0.0.1:<port> through Gecko's socket transport.
	async _connect() {
		var C = Components.classes;
		var I = Components.interfaces;
		var sts = C["@mozilla.org/network/socket-transport-service;1"]
			.getService(I.nsISocketTransportService);
		var transport = sts.createTransport([], "127.0.0.1", this.port(), null, null);
		transport.setTimeout(I.nsISocketTransport.TIMEOUT_CONNECT, 3);
		transport.setTimeout(I.nsISocketTransport.TIMEOUT_READ_WRITE, 15);

		var out = transport.openOutputStream(I.nsITransport.OPEN_BLOCKING | I.nsITransport.OPEN_UNBUFFERED, 0, 0);
		var inp = transport.openInputStream(I.nsITransport.OPEN_UNBUFFERED, 0, 0)
			.QueryInterface(I.nsIAsyncInputStream);
		var bin = C["@mozilla.org/binaryinputstream;1"].createInstance(I.nsIBinaryInputStream);
		bin.setInputStream(inp);
		var decoder = new TextDecoder("utf-8");
		var onData = null;
		var onClose = null;
		var closed = false;

		var watch = () => {
			if (closed) return;
			inp.asyncWait({
				onInputStreamReady(stream) {
					try {
						var n = stream.available();
						if (n <= 0) throw new Error("eof");
						var chunk = decoder.decode(new Uint8Array(bin.readByteArray(n)), { stream: true });
						if (onData) onData(chunk);
						watch();
					} catch (e) {
						if (!closed && onClose) onClose();
					}
				},
			}, 0, 0, Services.tm.mainThread);
		};

		return {
			write(str) {
				var off = 0;
				while (off < str.length) off += out.write(str.slice(off), str.length - off);
			},
			onData(cb) { onData = cb; watch(); }, // start reading once someone listens
			onClose(cb) { onClose = cb; },
			close() {
				closed = true;
				try { inp.close(); } catch (e) { /* ignore */ }
				try { out.close(); } catch (e) { /* ignore */ }
				try { transport.close(0); } catch (e) { /* ignore */ }
			},
		};
	},

	// ---------- formatting through Zotero's own citation engine ----------

	selectedRegularItems() {
		var pane = Zotero.getActiveZoteroPane();
		var seen = new Set();
		var out = [];
		for (var it of pane.getSelectedItems()) {
			var top = it.isRegularItem() ? it : it.parentItem;
			if (top && top.isRegularItem() && !seen.has(top.id)) {
				seen.add(top.id);
				out.push(top);
			}
		}
		return out;
	},

	async _withEngine(items, fn) {
		var styleID = this.styleID();
		var style = Zotero.Styles.get(styleID);
		if (!style) throw new Error("Citation style not found: " + styleID);
		var engine = await style.getCiteProc(this.locale(), "text");
		try {
			var ids = items.map((i) => i.id);
			engine.updateItems(ids);
			return fn(engine, ids);
		} finally {
			try { engine.free(); } catch (e) { /* ignore */ }
		}
	},

	formatCitation(items) {
		return this._withEngine(items, (engine, ids) => {
			var citation = { citationItems: ids.map((id) => ({ id })), properties: {} };
			return engine.previewCitationCluster(citation, [], [], "text");
		});
	},

	formatBibliography(items) {
		return this._withEngine(items, (engine) => {
			var bib = engine.makeBibliography();
			if (!bib) throw new Error("This citation style doesn't produce a bibliography.");
			return bib[1].map((e) => e.replace(/\s+$/, "")).join("\n");
		});
	},

	// ---------- UI ----------

	notify(text, isError) {
		var pw = new Zotero.ProgressWindow({ closeOnClick: true });
		pw.changeHeadline("WordCraft");
		pw.addDescription(text);
		pw.show();
		pw.startCloseTimer(isError ? 9000 : 3500);
	},

	friendlyError(e) {
		var m = (e && e.message) || String(e);
		if (/unauthorized/i.test(m)) {
			return "WordCraft rejected the control key. Restart WordCraft (--control " + this.port() +
				") or check extensions.wordcraft.key.";
		}
		if (/closed the connection|CONNECTION_REFUSED|Timed out|NS_ERROR|NS_BASE_STREAM/i.test(m)) {
			return "Couldn't reach WordCraft on 127.0.0.1:" + this.port() +
				". Start it with: wordcraft --control " + this.port();
		}
		return m;
	},

	async run(label, fn) {
		try {
			await fn();
		} catch (e) {
			this.log(label + " failed: " + e);
			this.notify(this.friendlyError(e), true);
		}
	},

	cmdCite() {
		return this.run("cite", async () => {
			var items = this.selectedRegularItems();
			if (!items.length) return this.notify("Select one or more items first.", true);
			var text = await this.formatCitation(items);
			await this.client().insertText(text);
			this.notify("Inserted: " + text);
		});
	},

	cmdBibliography() {
		return this.run("bibliography", async () => {
			var items = this.selectedRegularItems();
			if (!items.length) return this.notify("Select one or more items first.", true);
			var text = await this.formatBibliography(items);
			await this.client().insertText(text);
			this.notify("Inserted " + items.length + " bibliography entr" + (items.length === 1 ? "y." : "ies."));
		});
	},

	cmdTest() {
		return this.run("test", async () => {
			var cmds = await this.client().commands();
			var ids = cmds.map((c) => (typeof c === "string" ? c : c.id)).filter(Boolean);
			var zot = ids.filter((id) => id.indexOf("ui.zotero") === 0);
			this.notify(
				"Connected on port " + this.port() + ". " + ids.length + " commands" +
				(zot.length ? "; built-in Zotero commands: " + zot.join(", ") : "; no built-in ui.zotero.* commands.")
			);
		});
	},

	cmdSaveCommands() {
		return this.run("save-commands", async () => {
			var cmds = await this.client().commands();
			var dir;
			try { dir = Services.dirsvc.get("Desk", Components.interfaces.nsIFile).path; }
			catch (e) { dir = Zotero.DataDirectory.dir; }
			var path = PathUtils.join(dir, "wordcraft-commands.json");
			await IOUtils.writeUTF8(path, JSON.stringify(cmds, null, 2));
			this.notify("Saved " + cmds.length + " WordCraft commands to " + path);
		});
	},

	addToWindow(win) {
		var doc = win.document;
		if (doc.getElementById("wordcraft-cite")) return; // already added

		var track = (el, id) => { el.id = id; this._menuIDs.push(id); return el; };
		var item = (id, label, handler) => {
			var el = track(doc.createXULElement("menuitem"), id);
			el.setAttribute("label", label);
			el.addEventListener("command", handler);
			return el;
		};

		var itemMenu = doc.getElementById("zotero-itemmenu");
		if (itemMenu) {
			var sep = track(doc.createXULElement("menuseparator"), "wordcraft-sep");
			var cite = item("wordcraft-cite", "Cite in WordCraft", () => this.cmdCite());
			var bib = item("wordcraft-bib", "Insert Bibliography in WordCraft", () => this.cmdBibliography());
			itemMenu.append(sep, cite, bib);
			var onShowing = () => {
				var show = this.selectedRegularItems().length > 0;
				sep.hidden = cite.hidden = bib.hidden = !show;
			};
			itemMenu.addEventListener("popupshowing", onShowing);
			this._listeners.push([itemMenu, "popupshowing", onShowing]);
		}

		var tools = doc.getElementById("menu_ToolsPopup");
		if (tools) {
			tools.append(
				track(doc.createXULElement("menuseparator"), "wordcraft-tools-sep"),
				item("wordcraft-test", "WordCraft: Test Connection", () => this.cmdTest()),
				item("wordcraft-save-commands", "WordCraft: Save Command List", () => this.cmdSaveCommands())
			);
		}
	},

	removeFromWindow(win) {
		var doc = win.document;
		for (var [target, type, fn] of this._listeners) {
			try { target.removeEventListener(type, fn); } catch (e) { /* window gone */ }
		}
		this._listeners = [];
		for (var id of this._menuIDs) doc.getElementById(id)?.remove();
		this._menuIDs = [];
	},
};
