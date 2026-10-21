import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
	bundledPackages,
	createDiskExtensions,
	devRegistryRoot,
	handleExtensionApiRequest,
	nodeIo,
	ROUTE_LIMITS,
} from "./vault-api-extensions.ts";
import { diskSaveRecovery } from "./vault-api-save-recovery.ts";
import { vaultApiPlugin } from "./vault-api-plugin.ts";

// Real disposable files only: a fresh registry and synthetic vault per test, removed afterwards.
// The native Rust tests stay authoritative for platform durability and handle behaviour.
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const fixture = (name) => readFileSync(new URL(`../src/leadinglight/extensions/fixtures/${name}`, import.meta.url), "utf8");
const QUICK = fixture("quick-note.json");
const BUNDLED_FILE = new URL("../src-tauri/src/leadinglight_extensions/bundled/meeting-debrief.json", import.meta.url);
const TEXT = "# Debrief\n\nLiteral <b>text</b> stays text.\n";
const quickNote = (version = "1.0.0", id = "local.quick-note") =>
	QUICK.replace('"id": "local.quick-note"', `"id": "${id}"`).replace('"version": "1.0.0"', `"version": "${version}"`);
const failure = (code) => Object.assign(new Error(code), { code });
const asRoot = process.getuid?.() === 0;

async function withWorld(check) {
	const base = await mkdtemp(path.join(os.tmpdir(), "ll-extensions-"));
	const root = path.join(base, "registry");
	const vault = path.join(base, "vault");
	mkdirSync(path.join(vault, "Meetings"), { recursive: true });
	writeFileSync(path.join(vault, "Meetings", "Existing.md"), "old");
	writeFileSync(path.join(vault, "page.md"), "a page");
	const warnings = [];
	const make = (io = nodeIo) => {
		const extensions = createDiskExtensions({ root, bundled: bundledPackages(), io, warn: (message) => warnings.push(message) });
		extensions.noteVault(vault);
		return extensions;
	};
	try {
		await check({ base, root, vault, make, warnings });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
}

function client(extensions, vault) {
	const owner = extensions.register();
	const call = async (command, args, who = owner) => {
		const response = await extensions.command(command, { owner: who, args });
		assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
		return response.payload;
	};
	const api = {
		owner,
		call,
		importText: (packageText) => call("import_extension_candidate", { packageText }),
		entry: async (packageId) =>
			(await call("list_extensions", { vaultPath: vault })).extensions.find((item) => item.packageId === packageId),
		activate: (text, expected = null) =>
			call("activate_extension_version", {
				vaultPath: vault,
				packageId: JSON.parse(text).id,
				packageSha256: sha(text),
				expectedActiveSha256: expected,
			}),
		session: async () => (await call("open_extension_session", { vaultPath: vault })).sessionId,
		bind: (runId, folder = "Meetings") => call("bind_extension_folder", { runId, folder }),
		ready: async (folder = "Meetings", text = QUICK) => {
			await api.importText(text);
			if (!(await api.entry(JSON.parse(text).id))?.activeSha256) await api.activate(text);
			const sessionId = await api.session();
			const invocationId = randomUUID();
			const admission = await call("begin_extension_run", {
				sessionId,
				packageSha256: sha(text),
				commandId: "quick",
				invocationId,
			});
			assert.equal(admission.status, "admitted", JSON.stringify(admission));
			const runId = admission.scope.runId;
			const bound = await api.bind(runId, folder);
			return { sessionId, invocationId, runId, folderHandle: bound.folderHandle };
		},
		proposal: ({ runId, folderHandle }, fileName = "Debrief.md", content = TEXT) => ({
			kind: "create",
			operationId: randomUUID(),
			runId,
			content,
			contentSha256: sha(content),
			folderHandle,
			fileName,
		}),
		submit: (proposal) => call("submit_document_proposal", { proposal }),
		query: (operationId) => call("query_document_proposal", { operationId }),
	};
	return api;
}

const stagingLeft = (folder) => readdirSync(folder).filter((name) => name.startsWith(".leadinglight-"));
const packageFiles = (root) => {
	try {
		return readdirSync(path.join(root, "packages")).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
	} catch {
		return [];
	}
};

test("creates one page on disk with exactly the reviewed bytes, and answers a lost reply by query only", () =>
	withWorld(async ({ root, vault, make }) => {
		const api = client(make(), vault);
		const run = await api.ready();
		const proposal = api.proposal(run);
		const receipt = await api.submit(proposal);
		const page = path.join(vault, "Meetings", "Debrief.md");
		// A new page offers Undo (to Trash) while its session has a free slot.
		assert.match(receipt.undoReceipt, /^undo-[0-9a-f-]{36}$/);
		assert.deepEqual(receipt, {
			status: "committed",
			kind: "create",
			operationId: proposal.operationId,
			path: page,
			beforeSha256: null,
			afterSha256: sha(TEXT),
			durable: true,
			undoReceipt: receipt.undoReceipt,
		});
		assert.equal(readFileSync(page, "utf8"), TEXT);
		assert.equal(lstatSync(page).nlink, 1);
		assert.deepEqual(await api.query(proposal.operationId), receipt);
		assert.deepEqual(await api.submit(proposal), receipt);
		assert.deepEqual(readdirSync(path.join(vault, "Meetings")).sort(), ["Debrief.md", "Existing.md"]);
		assert.deepEqual(readdirSync(vault).sort(), ["Meetings", "page.md"]);
		assert.deepEqual(stagingLeft(path.join(vault, "Meetings")), []);
		assert.ok(existsSync(path.join(root, "preferences.json")));
		assert.ok(!readFileSync(path.join(root, "preferences.json"), "utf8").includes("Literal"));
	}));

test("keeps activation across a restart but answers earlier sessions and operations as unknown", () =>
	withWorld(async ({ vault, make }) => {
		const api = client(make(), vault);
		const run = await api.ready();
		const proposal = api.proposal(run);
		await api.submit(proposal);
		const restarted = client(make(), vault);
		assert.equal((await restarted.entry("local.quick-note")).activeSha256, sha(QUICK));
		assert.deepEqual(await restarted.query(proposal.operationId), { status: "unknown", operationId: proposal.operationId });
		assert.deepEqual(await restarted.call("close_extension_session", { sessionId: run.sessionId }), { status: "unknown" });
		const again = await restarted.ready();
		assert.equal((await restarted.submit(restarted.proposal(again, "Second.md"))).status, "committed");
	}));

test("serves only vaults the browser listed through this server, resolved, never a path it was merely given", () =>
	withWorld(async ({ base, vault, make }) => {
		const extensions = make();
		const api = client(extensions, vault);
		const other = path.join(base, "unlisted");
		mkdirSync(other);
		for (const vaultPath of [other, "relative/vault", `${vault}/../vault`, path.join(vault, "page.md")]) {
			assert.deepEqual(await api.call("list_extensions", { vaultPath }), { status: "refused", reason: "vaultUnavailable" }, vaultPath);
			assert.deepEqual(await api.call("open_extension_session", { vaultPath }), { status: "refused", reason: "vaultUnavailable" });
		}
		const alias = path.join(base, "alias");
		symlinkSync(vault, alias);
		extensions.noteVault(alias);
		const viaAlias = client(extensions, alias);
		const run = await viaAlias.ready();
		const receipt = await viaAlias.submit(viaAlias.proposal(run, "Aliased.md"));
		assert.equal(receipt.path, path.join(alias, "Meetings", "Aliased.md"));
		assert.ok(existsSync(path.join(vault, "Meetings", "Aliased.md")));
	}));

test("binds only real visible folders inside the vault, with no link followed", () =>
	withWorld(async ({ base, vault, make }) => {
		const api = client(make(), vault);
		const outside = path.join(base, "outside");
		mkdirSync(outside);
		mkdirSync(path.join(vault, ".leadinglight"));
		mkdirSync(path.join(vault, "Real", "Inner"), { recursive: true });
		symlinkSync(outside, path.join(vault, "Linked"));
		symlinkSync(path.join(vault, "Real"), path.join(vault, "Alias"));
		const { runId } = await api.ready();
		const refused = (reason) => ({ status: "refused", reason });
		for (const folder of ["../outside", outside, ".leadinglight", "Real/../..", "./Real"]) {
			assert.deepEqual(await api.bind(runId, folder), refused("outsideVault"), folder);
		}
		assert.deepEqual(await api.bind(runId, "Missing"), refused("missing"));
		assert.deepEqual(await api.bind(runId, "page.md"), refused("notFolder"));
		assert.deepEqual(await api.bind(runId, "Linked"), refused("link"));
		assert.deepEqual(await api.bind(runId, "Alias/Inner"), refused("link"));
		assert.equal((await api.bind(runId, "Real/Inner")).displayPath, "Real/Inner");
		assert.equal((await api.bind(runId, "")).displayPath, "");
		const page = await api.call("bind_extension_document", { runId, path: "page.md" });
		assert.equal(page.status, "bound");
		assert.equal(page.displayPath, "page.md");
		assert.equal(page.contentSha256, sha("a page"));
		writeFileSync(path.join(outside, "x.md"), "outside");
		assert.deepEqual(await api.call("bind_extension_document", { runId, path: "Linked/x.md" }), refused("link"));
		assert.deepEqual(await api.call("bind_extension_document", { runId, path: "../outside/x.md" }), refused("outsideVault"));
		assert.deepEqual(await api.call("bind_extension_document", { runId, path: "Real" }), refused("outsideVault"));
		assert.deepEqual(await api.call("bind_extension_document", { runId, path: "Missing.md" }), refused("missing"));
	}));

test("adds to a bound page once, keeping its earlier text first, and Undo restores it exactly", () =>
	withWorld(async ({ root, vault, make }) => {
		const api = client(make(), vault);
		const run = await api.ready();
		const page = path.join(vault, "Meetings", "Existing.md");
		const bound = await api.call("bind_extension_document", { runId: run.runId, path: "Meetings/Existing.md" });
		const after = "old\n\n> Later\n";
		const proposal = {
			kind: "append", operationId: randomUUID(), runId: run.runId, content: after, contentSha256: sha(after),
			documentHandle: bound.documentHandle, expectedSha256: bound.contentSha256,
		};
		const receipt = await api.submit(proposal);
		assert.equal(receipt.status, "committed", JSON.stringify(receipt));
		assert.equal(receipt.beforeSha256, sha("old"));
		assert.equal(readFileSync(page, "utf8"), after);
		assert.deepEqual(stagingLeft(path.join(vault, "Meetings")), []);
		assert.deepEqual(readdirSync(path.join(root, "undo")), [`${receipt.undoReceipt}.md`]);
		assert.deepEqual(await api.submit(proposal), receipt);

		const request = {
			operationId: randomUUID(), sessionId: run.sessionId, undoReceipt: receipt.undoReceipt, kind: "append",
			expectedSha256: receipt.afterSha256, beforeSha256: receipt.beforeSha256,
		};
		writeFileSync(page, `${after}typed later\n`);
		assert.deepEqual(await api.call("undo_document_proposal", { request }), { status: "conflict", operationId: request.operationId, reason: "changed" });
		assert.equal(readFileSync(page, "utf8"), `${after}typed later\n`);
		writeFileSync(page, after);
		const again = { ...request, operationId: randomUUID() };
		const undone = await api.call("undo_document_proposal", { request: again });
		assert.equal(undone.status, "undone", JSON.stringify(undone));
		assert.equal(readFileSync(page, "utf8"), "old");
		assert.deepEqual(readdirSync(path.join(root, "undo")), []);
		assert.deepEqual(await api.call("query_document_undo", { operationId: again.operationId }), undone);
	}));

test("writes nothing when the bound page changed before the append", () =>
	withWorld(async ({ vault, make }) => {
		const api = client(make(), vault);
		const run = await api.ready();
		const page = path.join(vault, "Meetings", "Existing.md");
		const bound = await api.call("bind_extension_document", { runId: run.runId, path: "Meetings/Existing.md" });
		writeFileSync(page, "edited elsewhere");
		const after = "old\nadded\n";
		const receipt = await api.submit({
			kind: "append", operationId: randomUUID(), runId: run.runId, content: after, contentSha256: sha(after),
			documentHandle: bound.documentHandle, expectedSha256: bound.contentSha256,
		});
		assert.equal(receipt.status, "conflict");
		assert.equal(receipt.reason, "changed");
		assert.equal(readFileSync(page, "utf8"), "edited elsewhere");
		assert.deepEqual(stagingLeft(path.join(vault, "Meetings")), []);
	}));

test("never writes into a bound folder that was replaced, removed or turned into a link", () =>
	withWorld(async ({ base, vault, make }) => {
		const api = client(make(), vault);
		const meetings = path.join(vault, "Meetings");
		const cases = [
			["replaced", () => { renameSync(meetings, path.join(base, "old-1")); mkdirSync(meetings); }, "handleMismatch"],
			["removed", () => renameSync(meetings, path.join(base, "old-2")), "storageUnavailable"],
			["linked", () => { renameSync(meetings, path.join(base, "old-3")); symlinkSync(path.join(base, "old-3"), meetings); }, "handleMismatch"],
		];
		for (const [name, change, reason] of cases) {
			if (!existsSync(meetings)) mkdirSync(meetings);
			const run = await api.ready();
			change();
			const proposal = api.proposal(run, `${name}.md`);
			assert.deepEqual(await api.submit(proposal), { status: "refused", operationId: proposal.operationId, reason }, name);
			for (const folder of ["old-1", "old-2", "old-3"]) assert.ok(!existsSync(path.join(base, folder, `${name}.md`)));
			rmSync(meetings, { recursive: true, force: true });
		}
	}));

test("never writes over an existing page, and leaves no staging behind", () =>
	withWorld(async ({ vault, make }) => {
		const api = client(make(), vault);
		const run = await api.ready();
		const proposal = api.proposal(run, "Existing.md");
		assert.deepEqual(await api.submit(proposal), { status: "conflict", operationId: proposal.operationId, reason: "exists" });
		assert.equal(readFileSync(path.join(vault, "Meetings", "Existing.md"), "utf8"), "old");
		assert.deepEqual(stagingLeft(path.join(vault, "Meetings")), []);
	}));

test("reuses the save lease: a page held by save recovery answers busy and is not created", () =>
	withWorld(async ({ vault, make }) => {
		const page = path.join(vault, "Meetings", "Held.md");
		const content = "unsaved draft";
		const held = await diskSaveRecovery.savePageContent({
			request: { requestId: randomUUID(), vaultPath: vault, session: "s1", path: page, seq: 1, submittedSha256: sha(content) },
			content,
		});
		assert.equal(held.status, "refused");
		const api = client(make(), vault);
		const run = await api.ready();
		const proposal = api.proposal(run, "Held.md");
		assert.deepEqual(await api.submit(proposal), { status: "refused", operationId: proposal.operationId, reason: "busy" });
		assert.ok(!existsSync(page));
	}));

test("a failed publication proves no write only while the staged file is ours and the name is free", () =>
	withWorld(async ({ vault, make, warnings }) => {
		const meetings = path.join(vault, "Meetings");
		const scenario = async (name, link, expected) => {
			const api = client(make({ ...nodeIo, link }), vault);
			const run = await api.ready();
			const proposal = api.proposal(run, `${name}.md`);
			const receipt = await api.submit(proposal);
			assert.equal(receipt.status, expected, `${name}: ${JSON.stringify(receipt)}`);
			assert.deepEqual(await api.query(proposal.operationId), receipt);
			assert.deepEqual(await api.submit(proposal), receipt);
			return { receipt, page: path.join(meetings, `${name}.md`) };
		};
		const notLinked = await scenario("NotLinked", () => { throw failure("EIO"); }, "refused");
		assert.equal(notLinked.receipt.reason, "storageUnavailable");
		assert.ok(!existsSync(notLinked.page));
		assert.deepEqual(stagingLeft(meetings), []);
		const linked = await scenario("Linked", (staged, target) => { linkSync(staged, target); throw failure("EIO"); }, "committed");
		assert.equal(readFileSync(linked.page, "utf8"), TEXT);
		assert.equal(lstatSync(linked.page).nlink, 1);
		const raced = await scenario("Raced", (staged, target) => { writeFileSync(target, "someone else"); linkSync(staged, target); }, "conflict");
		assert.equal(readFileSync(raced.page, "utf8"), "someone else");
		assert.deepEqual(stagingLeft(meetings), []);
		const unknown = await scenario("Unknown", (_staged, target) => { writeFileSync(target, "someone else"); throw failure("EIO"); }, "uncertain");
		assert.equal(readFileSync(unknown.page, "utf8"), "someone else");
		assert.equal(stagingLeft(meetings).length, 1);
		assert.ok(warnings.some((message) => message.includes("could not be confirmed")));
	}));

test("reports durability, an extra link and a changed page after publication honestly", () =>
	withWorld(async ({ vault, make }) => {
		const meetings = path.join(vault, "Meetings");
		const unsynced = client(make({ ...nodeIo, syncDir: (dir) => (dir.endsWith("Meetings") ? false : nodeIo.syncDir(dir)) }), vault);
		const first = await unsynced.submit(unsynced.proposal(await unsynced.ready(), "Unsynced.md"));
		assert.equal(first.status, "committed");
		assert.equal(first.durable, false);
		const stuck = (target) => {
			if (target.includes(`${path.sep}.leadinglight-`)) throw failure("EIO");
			unlinkSync(target);
		};
		const linked = client(make({ ...nodeIo, unlink: stuck }), vault);
		const second = await linked.submit(linked.proposal(await linked.ready(), "StillLinked.md"));
		assert.equal(second.status, "uncertain");
		assert.equal(lstatSync(path.join(meetings, "StillLinked.md")).nlink, 2);
		const changed = client(
			make({
				...nodeIo,
				syncDir: (dir) => {
					if (dir.endsWith("Meetings") && existsSync(path.join(dir, "Changed.md"))) appendFileSync(path.join(dir, "Changed.md"), "!");
					return nodeIo.syncDir(dir);
				},
			}),
			vault,
		);
		const third = await changed.submit(changed.proposal(await changed.ready(), "Changed.md"));
		assert.equal(third.status, "uncertain");
		assert.deepEqual(await changed.query(third.operationId), third);
		// The uncertain page is never written again: a fresh request for the name meets it.
		const retry = changed.proposal(await changed.ready(), "Changed.md");
		assert.deepEqual(await changed.submit(retry), { status: "conflict", operationId: retry.operationId, reason: "exists" });
		assert.equal(readFileSync(path.join(meetings, "Changed.md"), "utf8"), `${TEXT}!`);
	}));

test("publishes preferences in one rename: a failure before it changes nothing, after it is the state", () =>
	withWorld(async ({ root, vault, make, warnings }) => {
		const mode = { value: "ok" };
		const io = {
			...nodeIo,
			rename: (from, to) => {
				if (to.endsWith("preferences.json") && mode.value === "before") throw failure("EIO");
				renameSync(from, to);
				if (to.endsWith("preferences.json") && mode.value === "after") throw failure("EIO");
			},
			syncDir: (dir) => (dir === root && mode.value === "unsynced" ? false : nodeIo.syncDir(dir)),
		};
		const api = client(make(io), vault);
		const [a, b, c] = [quickNote("1.0.0"), quickNote("2.0.0"), quickNote("3.0.0")];
		for (const text of [a, b, c]) await api.importText(text);
		await api.activate(a);
		const run = await api.ready("Meetings", a);
		const before = readFileSync(path.join(root, "preferences.json"), "utf8");
		mode.value = "before";
		assert.deepEqual(await api.activate(b, sha(a)), { status: "refused", reason: "vaultUnavailable", missingCapabilities: [] });
		assert.equal(readFileSync(path.join(root, "preferences.json"), "utf8"), before);
		assert.deepEqual(readdirSync(root).filter((name) => name.startsWith(".tmp-")), []);
		assert.equal((await api.bind(run.runId)).status, "bound");
		mode.value = "after";
		assert.equal((await api.activate(b, sha(a))).status, "active");
		assert.deepEqual(await api.bind(run.runId), { status: "refused", reason: "staleRun" });
		mode.value = "unsynced";
		assert.equal((await api.activate(c, sha(b))).status, "active");
		assert.ok(warnings.some((message) => message.includes("could not be synced")));
		assert.equal((await client(make(), vault).entry("local.quick-note")).activeSha256, sha(c));
	}));

test("sets aside corrupt, oversized or linked preferences and starts with everything off", () =>
	withWorld(async ({ root, vault, make }) => {
		const setup = client(make(), vault);
		await setup.importText(QUICK);
		await setup.activate(QUICK);
		const prefs = path.join(root, "preferences.json");
		const aside = path.join(root, "preferences.unreadable.json");
		const breaks = [
			() => writeFileSync(prefs, "not json"),
			() => writeFileSync(prefs, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20)),
			() => { const target = path.join(root, "elsewhere.json"); renameSync(prefs, target); symlinkSync(target, prefs); },
		];
		for (const [index, broken] of breaks.entries()) {
			const fresh = client(make(), vault);
			await fresh.activate(QUICK, (await fresh.entry("local.quick-note")).activeSha256);
			broken();
			rmSync(aside, { force: true });
			const recovered = client(make(), vault);
			const entry = await recovered.entry("local.quick-note");
			assert.equal(entry.activeSha256, null, `case ${index}`);
			assert.equal(entry.versions.length, 1, `case ${index}`);
			assert.ok(lstatSync(aside, { throwIfNoEntry: false }) !== undefined, `case ${index}`);
			assert.equal((await recovered.activate(QUICK)).status, "active");
		}
	}));

test("refuses a tampered package everywhere it would be used", () =>
	withWorld(async ({ root, vault, make }) => {
		const api = client(make(), vault);
		await api.importText(QUICK);
		await api.activate(QUICK);
		const file = path.join(root, "packages", `${sha(QUICK)}.json`);
		writeFileSync(file, QUICK.replace("Quick note", "Quick n0te"));
		const restarted = client(make(), vault);
		const entry = await restarted.entry("local.quick-note");
		assert.equal(entry.versions[0].readable, false);
		assert.equal(entry.activeSha256, sha(QUICK));
		const session = await restarted.session();
		assert.deepEqual(
			await restarted.call("begin_extension_run", { sessionId: session, packageSha256: sha(QUICK), commandId: "quick", invocationId: "k1" }),
			{ status: "refused", reason: "unreadable" },
		);
		assert.deepEqual(await restarted.call("read_extension_package", { packageSha256: sha(QUICK) }), { status: "unreadable" });
		assert.equal((await restarted.importText(QUICK)).status, "candidate");
		assert.equal((await restarted.entry("local.quick-note")).versions[0].readable, true);
	}));

test("keeps package files bounded under failed publication, failed removal and an overfull folder", () =>
	withWorld(async ({ root, vault, make }) => {
		const faults = { prefs: false, removal: false };
		const io = {
			...nodeIo,
			rename: (from, to) => {
				if (faults.prefs && to.endsWith("preferences.json")) throw failure("EIO");
				renameSync(from, to);
			},
			unlink: (target) => {
				if (faults.removal && target.includes(`${path.sep}packages${path.sep}`)) throw failure("EIO");
				unlinkSync(target);
			},
		};
		const api = client(make(io), vault);
		await api.importText(QUICK);
		await api.activate(QUICK);
		faults.prefs = true;
		for (let n = 0; n < 5; n++) assert.equal((await api.importText(quickNote(`5.${n}.0`, `local.fail-${n}`))).status, "refused");
		assert.equal(packageFiles(root).length, 1);
		faults.removal = true;
		let most = 0;
		for (let n = 0; n < 70; n++) {
			await api.importText(quickNote(`6.${n}.0`, `local.leak-${n}`));
			most = Math.max(most, packageFiles(root).length);
		}
		assert.ok(most <= 65, `${most} package files`);
		assert.ok(packageFiles(root).includes(`${sha(QUICK)}.json`));
		faults.prefs = false;
		faults.removal = false;
		assert.equal((await api.importText(quickNote("7.0.0"))).status, "candidate");
		assert.equal(packageFiles(root).length, 2);
		for (let n = 0; n < 257; n++) writeFileSync(path.join(root, "packages", `junk-${n}`), "");
		assert.deepEqual(await api.importText(quickNote("8.0.0")), { status: "refused", reason: "storageUnavailable" });
		for (const name of readdirSync(path.join(root, "packages"))) if (name.startsWith("junk-")) unlinkSync(path.join(root, "packages", name));
		assert.equal((await api.importText(quickNote("8.0.0"))).status, "candidate");
	}));

test("keeps the dev registry in a disposable namespace, never an app configuration folder", () => {
	const checkout = "/work/LeadingLight";
	const namespace = devRegistryRoot({}, checkout);
	assert.ok(namespace.startsWith(os.tmpdir()));
	assert.equal(devRegistryRoot({}, checkout), namespace);
	assert.notEqual(devRegistryRoot({}, "/work/Other"), namespace);
	assert.equal(devRegistryRoot({ LEADINGLIGHT_DEV_EXTENSIONS_DIR: "/tmp/ll-qa-registry" }, checkout), "/tmp/ll-qa-registry");
	assert.equal(devRegistryRoot({ LEADINGLIGHT_DEV_EXTENSIONS_DIR: "relative" }, checkout), namespace);
	for (const inside of [path.join(os.homedir(), ".config", "leadinglight"), path.join(os.homedir(), "Library", "Application Support", "x")]) {
		assert.throws(() => devRegistryRoot({ LEADINGLIGHT_DEV_EXTENSIONS_DIR: inside }, checkout), /app configuration folder/);
	}
});

test("reads the native bundled package as exact bytes and lists it off under its reserved id", () =>
	withWorld(async ({ vault, make }) => {
		const [bundled] = bundledPackages();
		assert.equal(bundled, readFileSync(BUNDLED_FILE, "utf8"));
		const entry = await client(make(), vault).entry("leadinglight.meeting-debrief");
		assert.deepEqual(entry.versions, [{ packageSha256: sha(bundled), version: "1.0.0", readable: true }]);
		assert.equal(entry.activeSha256, null);
	}));

function fakeRequest(method, url, body, contentType = "application/json") {
	const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
	return Object.assign(Readable.from(payload), { method, url, headers: { "content-type": contentType } });
}

async function serve(extensions, method, url, body, contentType) {
	const res = {
		statusCode: 0,
		headers: {},
		body: "",
		setHeader(key, value) {
			this.headers[key] = value;
		},
		end(text) {
			this.body = text;
		},
	};
	const handled = await handleExtensionApiRequest(fakeRequest(method, url, body, contentType), res, extensions);
	return { handled, status: res.statusCode, body: res.body === "" ? null : JSON.parse(res.body) };
}

test("routes only whitelisted extension commands, for owners this route issued", () =>
	withWorld(async ({ vault, make }) => {
		const extensions = make();
		assert.equal((await serve(extensions, "POST", "/api/vault/ping", {})).handled, false);
		assert.equal((await serve(extensions, "GET", "/api/extensions/owner")).status, 405);
		assert.equal((await serve(extensions, "POST", "/api/extensions/owner", "{}", "text/plain")).status, 415);
		assert.equal((await serve(extensions, "POST", "/api/extensions/owner", "{")).status, 400);
		assert.equal((await serve(extensions, "POST", "/api/extensions/owner", "x".repeat(ROUTE_LIMITS.requestBytes + 1))).status, 413);
		const { owner } = (await serve(extensions, "POST", "/api/extensions/owner", {})).body;
		const list = { vaultPath: vault };
		assert.equal((await serve(extensions, "POST", "/api/extensions/list_extensions", { owner: "owner-forged", args: list })).status, 403);
		assert.equal((await serve(extensions, "POST", "/api/extensions/save_note_content", { owner, args: {} })).status, 404);
		assert.equal((await serve(extensions, "POST", "/api/extensions/list_extensions", { owner, args: {} })).status, 400);
		const listed = await serve(extensions, "POST", "/api/extensions/list_extensions", { owner, args: list });
		assert.equal(listed.status, 200);
		assert.equal(listed.body.status, "ok");
		const opened = await serve(extensions, "POST", "/api/extensions/open_extension_session", { owner, args: list });
		const { sessionId } = opened.body;
		assert.deepEqual((await serve(extensions, "POST", "/api/extensions/owner-end", { owner })).body, { ended: true });
		assert.equal((await serve(extensions, "POST", "/api/extensions/open_extension_session", { owner, args: list })).status, 403);
		assert.deepEqual((await serve(extensions, "POST", "/api/extensions/close_extension_session", { owner, args: { sessionId } })).body, { status: "closed" });
		assert.deepEqual((await serve(extensions, "POST", "/api/extensions/owner-end", { owner })).body, { ended: false });
	}));

test("forgets the oldest page owner past the bound, closing its sessions as a reloaded window's", () =>
	withWorld(async ({ vault, make }) => {
		const extensions = make();
		const first = client(extensions, vault);
		const run = await first.ready();
		for (let n = 0; n < ROUTE_LIMITS.owners; n++) extensions.register();
		const refused = await extensions.command("bind_extension_folder", { owner: first.owner, args: { runId: run.runId, folder: "Meetings" } });
		assert.equal(refused.statusCode, 403);
		const closed = await extensions.command("close_extension_session", { owner: first.owner, args: { sessionId: run.sessionId } });
		assert.deepEqual(closed.payload, { status: "closed" });
		const ended = await extensions.command("end_extension_run", { owner: first.owner, args: { sessionId: run.sessionId, invocationId: run.invocationId } });
		assert.deepEqual(ended.payload, { status: "ended" });
	}));

test("the dev server plugin answers extension routes before any vault route", async () => {
	const registry = await mkdtemp(path.join(os.tmpdir(), "ll-extensions-plugin-"));
	const previous = process.env.LEADINGLIGHT_DEV_EXTENSIONS_DIR;
	process.env.LEADINGLIGHT_DEV_EXTENSIONS_DIR = registry;
	try {
		let middleware = null;
		vaultApiPlugin().configureServer({ middlewares: { use: (handler) => { middleware = handler; } } });
		const res = { statusCode: 0, body: "", setHeader() {}, end(text) { this.body = text; } };
		let passed = false;
		await middleware(fakeRequest("POST", "/api/extensions/owner", {}), res, () => { passed = true; });
		assert.equal(passed, false);
		assert.equal(res.statusCode, 200);
		assert.match(JSON.parse(res.body).owner, /^owner-/);
		assert.deepEqual(readdirSync(registry), []);
	} finally {
		if (previous === undefined) delete process.env.LEADINGLIGHT_DEV_EXTENSIONS_DIR;
		else process.env.LEADINGLIGHT_DEV_EXTENSIONS_DIR = previous;
		await rm(registry, { recursive: true, force: true });
	}
});

test("refuses to create a page in a folder it cannot write, proving nothing was written", { skip: asRoot }, () =>
	withWorld(async ({ vault, make }) => {
		const api = client(make(), vault);
		const run = await api.ready();
		const locked = path.join(vault, "Meetings");
		chmodSync(locked, 0o500);
		try {
			const proposal = api.proposal(run, "Locked.md");
			assert.deepEqual(await api.submit(proposal), { status: "refused", operationId: proposal.operationId, reason: "storageUnavailable" });
		} finally {
			chmodSync(locked, 0o700);
		}
		assert.ok(!existsSync(path.join(locked, "Locked.md")));
	}));
