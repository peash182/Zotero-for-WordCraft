/*
 * WordCraft <-> Zotero: protocol core.
 * No Zotero or Gecko APIs in here, so it can be unit-tested in Node.
 *
 * WordCraft's control channel (docs/control-protocol.md): run `wordcraft --control <port>`;
 * it listens on 127.0.0.1, takes one JSON object per line and answers with one line:
 *   -> {"id":1,"key":"<hex>","method":"engine.execute","params":{"command":"text.insert","params":{"text":"Hi"}}}
 *   <- {"id":1,"ok":true,"result":{...}}   or   {"id":1,"ok":false,"error":"..."}
 * The key is a random hex string the app writes to <settings>/control-key.local-<port>.
 */
var WordCraftCore = (function () {
	"use strict";

	// JSON with every non-ASCII char \u-escaped, so the line is pure ASCII and can be
	// written through a plain byte stream without any UTF-8 handling.
	function asciiJSON(value) {
		return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (c) {
			return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
		});
	}

	// Where WordCraft keeps its preferences and control-key files, as path segments.
	function settingsDirParts(platform, env, home) {
		if (platform === "mac") return [home, "Library", "Application Support", "WordCraft"];
		if (platform === "win") {
			return env.APPDATA ? [env.APPDATA, "WordCraft"] : [home, "AppData", "Roaming", "WordCraft"];
		}
		return env.XDG_CONFIG_HOME ? [env.XDG_CONFIG_HOME, "wordcraft"] : [home, ".config", "wordcraft"];
	}

	// Zotero's Quick Copy preference looks like "bibliography=http://www.zotero.org/styles/apa".
	function parseQuickCopySetting(setting) {
		if (typeof setting !== "string") return null;
		var m = /^bibliography(?:\/\w+)?=(.+)$/.exec(setting.trim());
		return m ? m[1].trim() : null;
	}

	class Client {
		/*
		 * opts.connect():  () => Promise<conn>, conn = { write(str), onData(cb), onClose(cb), close() }
		 * opts.getKey():   () => Promise<string>      (re-read on every request; the app may restart)
		 * opts.setTimeout / opts.clearTimeout: timer functions (default: globals)
		 */
		constructor(opts) {
			this.connect = opts.connect;
			this.getKey = opts.getKey;
			this.timeoutMs = opts.timeoutMs || 8000;
			this._set = opts.setTimeout || setTimeout;
			this._clear = opts.clearTimeout || clearTimeout;
			this._nextId = 1;
		}

		async request(method, params) {
			var key = await this.getKey();
			var id = this._nextId++;
			var line = asciiJSON({ id: id, key: key, method: method, params: params || {} }) + "\n";
			var conn = await this.connect();
			var self = this;
			return new Promise(function (resolve, reject) {
				var buf = "";
				var done = false;
				var timer = null;
				function finish(fn, value) {
					if (done) return;
					done = true;
					if (timer !== null) self._clear(timer);
					try { conn.close(); } catch (e) { /* already closed */ }
					fn(value);
				}
				timer = self._set(function () {
					finish(reject, new Error("Timed out waiting for WordCraft"));
				}, self.timeoutMs);

				conn.onData(function (chunk) {
					buf += chunk;
					var nl;
					while ((nl = buf.indexOf("\n")) >= 0) {
						var text = buf.slice(0, nl).trim();
						buf = buf.slice(nl + 1);
						if (!text) continue;
						var msg;
						try { msg = JSON.parse(text); }
						catch (e) { return finish(reject, new Error("Unreadable reply from WordCraft")); }
						// Auth failures come back without an id.
						if (msg.id !== undefined && msg.id !== null && msg.id !== id) continue;
						if (msg.ok) return finish(resolve, msg.result);
						return finish(reject, new Error(msg.error || "WordCraft reported an error"));
					}
				});
				conn.onClose(function () {
					finish(reject, new Error("WordCraft closed the connection"));
				});
				try { conn.write(line); }
				catch (e) { finish(reject, e); }
			});
		}

		// Run any WordCraft command id, e.g. execute("text.insert", {text: "Hello"}).
		execute(command, params) {
			return this.request("engine.execute", { command: command, params: params || {} });
		}

		insertText(text) {
			return this.execute("text.insert", { text: text });
		}

		commands() {
			return this.request("engine.commands", {}).then(function (r) {
				return Array.isArray(r) ? r : (r && r.commands) || [];
			});
		}
	}

	return {
		asciiJSON: asciiJSON,
		settingsDirParts: settingsDirParts,
		parseQuickCopySetting: parseQuickCopySetting,
		Client: Client,
	};
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = WordCraftCore;
}
