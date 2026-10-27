// Run: node test/protocol.test.js
const net = require("net");
const assert = require("assert");
const core = require("../content/core.js");

const KEY = "ab".repeat(32);

// Mock of WordCraft's control channel: one JSON object per line, key check, one reply line.
function startMock({ splitReply = false, silent = false } = {}) {
	const received = [];
	const server = net.createServer((sock) => {
		let buf = "";
		sock.on("data", (d) => {
			buf += d.toString("utf8");
			let nl;
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
				let req;
				try { req = JSON.parse(line); } catch (e) { sock.end(JSON.stringify({ ok: false, error: "bad json" }) + "\n"); return; }
				received.push(req);
				if (silent) return;
				if (req.key !== KEY) { sock.end(JSON.stringify({ ok: false, error: "unauthorized" }) + "\n"); return; }
				let reply;
				if (req.method === "engine.execute") reply = { id: req.id, ok: true, result: { echoed: req.params } };
				else if (req.method === "engine.commands") reply = { id: req.id, ok: true, result: [{ id: "text.insert" }, { id: "ui.zotero.search" }] };
				else reply = { id: req.id, ok: false, error: "unknown method" };
				const out = JSON.stringify(reply) + "\n";
				if (splitReply) { sock.write(out.slice(0, 7)); setTimeout(() => sock.write(out.slice(7)), 20); }
				else sock.write(out);
			}
		});
	});
	return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ server, port: server.address().port, received })));
}

function nodeConnect(port) {
	return async () => {
		const s = net.createConnection(port, "127.0.0.1");
		s.setEncoding("utf8");
		s.on("error", () => {}); // a refused connection ends in "close", which the client reports
		return {
			write: (str) => s.write(str, "latin1"), // pure-ASCII lines only, like the Gecko stream
			onData: (cb) => s.on("data", cb),
			onClose: (cb) => s.on("close", cb),
			close: () => s.destroy(),
		};
	};
}

const mkClient = (port, key = KEY, extra = {}) =>
	new core.Client({ connect: nodeConnect(port), getKey: async () => key, ...extra });

(async () => {
	// asciiJSON: non-ASCII (Bangla, emoji, quotes) survives a round trip as pure ASCII
	const sample = { text: "বাংলা — “quoted” 😀 café" };
	const wire = core.asciiJSON(sample);
	assert.ok(/^[\x00-\x7f]*$/.test(wire), "wire format must be ASCII");
	assert.deepStrictEqual(JSON.parse(wire), sample);

	// settings dir per platform
	assert.deepStrictEqual(core.settingsDirParts("linux", {}, "/home/u"), ["/home/u", ".config", "wordcraft"]);
	assert.deepStrictEqual(core.settingsDirParts("linux", { XDG_CONFIG_HOME: "/x" }, "/home/u"), ["/x", "wordcraft"]);
	assert.deepStrictEqual(core.settingsDirParts("mac", {}, "/Users/u"), ["/Users/u", "Library", "Application Support", "WordCraft"]);
	assert.deepStrictEqual(core.settingsDirParts("win", { APPDATA: "C:\\A" }, "C:\\U"), ["C:\\A", "WordCraft"]);
	assert.deepStrictEqual(core.settingsDirParts("win", {}, "C:\\U"), ["C:\\U", "AppData", "Roaming", "WordCraft"]);

	// quick copy setting
	assert.strictEqual(core.parseQuickCopySetting("bibliography=http://www.zotero.org/styles/apa"), "http://www.zotero.org/styles/apa");
	assert.strictEqual(core.parseQuickCopySetting("bibliography/html=http://www.zotero.org/styles/ieee"), "http://www.zotero.org/styles/ieee");
	assert.strictEqual(core.parseQuickCopySetting("export=abc123"), null);
	assert.strictEqual(core.parseQuickCopySetting(undefined), null);

	// happy path, including non-ASCII text and a reply that arrives in two chunks
	for (const splitReply of [false, true]) {
		const m = await startMock({ splitReply });
		const r = await mkClient(m.port).insertText(sample.text);
		assert.strictEqual(r.echoed.command, "text.insert");
		assert.strictEqual(r.echoed.params.text, sample.text);
		assert.strictEqual(m.received[0].method, "engine.execute");
		assert.strictEqual(m.received[0].key, KEY);
		m.server.close();
	}

	// commands() unwraps the list
	{
		const m = await startMock();
		const cmds = await mkClient(m.port).commands();
		assert.deepStrictEqual(cmds.map((c) => c.id), ["text.insert", "ui.zotero.search"]);
		m.server.close();
	}

	// wrong key -> unauthorized (reply has no id)
	{
		const m = await startMock();
		await assert.rejects(mkClient(m.port, "wrong").insertText("x"), /unauthorized/);
		m.server.close();
	}

	// server error surfaces its message
	{
		const m = await startMock();
		await assert.rejects(mkClient(m.port).request("nope", {}), /unknown method/);
		m.server.close();
	}

	// no reply -> timeout
	{
		const m = await startMock({ silent: true });
		await assert.rejects(mkClient(m.port, KEY, { timeoutMs: 150 }).insertText("x"), /Timed out/);
		m.server.close();
	}

	// nothing listening -> rejection, not a hang
	{
		const m = await startMock();
		const port = m.port;
		await new Promise((r) => m.server.close(r));
		await assert.rejects(mkClient(port, KEY, { timeoutMs: 500 }).insertText("x"));
	}

	console.log("all protocol tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
