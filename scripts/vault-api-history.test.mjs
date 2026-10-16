import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	rmSync,
	symlinkSync,
	truncateSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseSaveOutcome } from "../src/leadinglight/saveOutcome.ts";
import { readExactly } from "./vault-api-history.ts";
import {
	createDiskPageHistory,
	diskPageHistory as history,
	diskSaveRecovery as recovery,
} from "./vault-api-save-recovery.ts";

// Real disposable folders only; native tests stay authoritative for locks and durability.
const sha = (data) => createHash("sha256").update(data).digest("hex");
const asRoot = process.getuid?.() === 0;

async function withVault(check) {
	const vault = await mkdtemp(path.join(os.tmpdir(), "ll-history-"));
	mkdirSync(path.join(vault, "notes", "deep"), { recursive: true });
	try {
		await check(vault, (relative) => path.join(vault, relative));
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
}

const save = (vault, page, content) =>
	recovery.savePageContent({
		request: {
			requestId: randomUUID(),
			vaultPath: vault,
			session: "s1",
			path: page,
			seq: 1,
			submittedSha256: sha(Buffer.from(content, "utf8")),
		},
		content,
	});
const versionsOf = (vault, page) =>
	history.listPageVersions({ vaultPath: vault, path: page, cursor: null })
		.versions;
const payloadOf = (vault, id) =>
	path.join(
		vault,
		".leadinglight",
		"history",
		"versions",
		...id.split("/"),
		"payload",
	);
const copy = (vault, row, folder = null, operationId = randomUUID()) =>
	history.savePageVersionAsCopy({
		vaultPath: vault,
		id: row.id,
		sha256: row.sha256,
		folder,
		operationId,
	});

test("a cleared page's earlier bytes are kept, shown only after verification, and copied exactly", () =>
	withVault(async (vault, at) => {
		const text = "﻿First line\r\nsecond ✓\r\n";
		const raw = Buffer.from([0x66, 0xff, 0x0a]);
		writeFileSync(at("notes/a.md"), text);
		writeFileSync(at("notes/raw.md"), raw);

		assert.deepEqual(await save(vault, at("notes/a.md"), ""), {
			status: "committed",
			written: true,
			durable: true,
			history: null,
		});
		await save(vault, at("notes/raw.md"), "now text");
		const [row] = versionsOf(vault, at("notes/a.md"));
		assert.equal(row.recordedPath, "notes/a.md");
		assert.equal(row.reason, "firstSave");
		assert.equal(row.sha256, sha(Buffer.from(text)));
		assert.deepEqual(
			history.readPageVersion({
				vaultPath: vault,
				id: row.id,
				sha256: row.sha256,
			}),
			{
				status: "ok",
				text,
				length: Buffer.byteLength(text),
				shownBytes: Buffer.byteLength(text),
				truncated: false,
				bom: true,
				crlf: true,
			},
		);

		const operationId = randomUUID();
		const created = copy(vault, row, null, operationId);
		assert.equal(created.relativePath, "notes/a-2.md");
		assert.ok(readFileSync(at("notes/a-2.md")).equals(Buffer.from(text)));
		assert.deepEqual(
			copy(vault, row, null, operationId),
			created,
			"an exact retry answers the same copy",
		);
		assert.equal(
			readFileSync(at("notes/a.md"), "utf8"),
			"",
			"the original is never written",
		);

		const [rawRow] = versionsOf(vault, at("notes/raw.md"));
		assert.equal(
			history.readPageVersion({
				vaultPath: vault,
				id: rawRow.id,
				sha256: rawRow.sha256,
			}).text,
			null,
		);
		copy(vault, rawRow);
		assert.ok(
			readFileSync(at("notes/raw-2.md")).equals(raw),
			"non-UTF-8 bytes copy byte for byte",
		);
	}));

test("a changed or vanished version is never shown or copied", () =>
	withVault(async (vault, at) => {
		writeFileSync(at("notes/a.md"), "kept words");
		await save(vault, at("notes/a.md"), "");
		const [row] = versionsOf(vault, at("notes/a.md"));
		const ask = { vaultPath: vault, id: row.id, sha256: row.sha256 };

		writeFileSync(payloadOf(vault, row.id), "kept wordz");
		assert.deepEqual(history.readPageVersion(ask), { status: "damaged" });
		assert.deepEqual(copy(vault, row), {
			status: "refused",
			reason: "damaged",
		});

		rmSync(path.dirname(payloadOf(vault, row.id)), { recursive: true });
		assert.deepEqual(history.readPageVersion(ask), { status: "missing" });
		assert.deepEqual(copy(vault, row), {
			status: "refused",
			reason: "missing",
		});
		assert.deepEqual(readdirSync(at("notes")).sort(), ["a.md", "deep"]);
	}));

test("a copy never takes a name, never falls back to another folder, and needs the same arguments to retry", () =>
	withVault(async (vault, at) => {
		writeFileSync(at("notes/a.md"), "first");
		writeFileSync(at("notes/a-2.md"), "occupied");
		writeFileSync(at("notes/deep/b.md"), "deep words");
		await save(vault, at("notes/a.md"), "");
		await save(vault, at("notes/deep/b.md"), "");
		const [row] = versionsOf(vault, at("notes/a.md"));
		const [deepRow] = versionsOf(vault, at("notes/deep/b.md"));

		const operationId = randomUUID();
		assert.equal(
			copy(vault, row, null, operationId).relativePath,
			"notes/a-3.md",
		);
		assert.equal(readFileSync(at("notes/a-2.md"), "utf8"), "occupied");
		assert.deepEqual(copy(vault, row, "notes/deep", operationId), {
			status: "refused",
			reason: "operationMismatch",
		});

		rmSync(at("notes/deep"), { recursive: true });
		assert.deepEqual(copy(vault, deepRow), {
			status: "folderUnavailable",
			recordedFolder: path.join(vault, "notes", "deep"),
		});
		assert.equal(copy(vault, deepRow, "notes").relativePath, "notes/b-2.md");
		assert.equal(readFileSync(at("notes/b-2.md"), "utf8"), "deep words");
	}));

test("an unaccountable or unwritable store never changes the page's save", () =>
	withVault(async (vault, at) => {
		const versions = at(".leadinglight/history/versions");
		mkdirSync(path.join(versions, "not-a-location"), { recursive: true });
		symlinkSync(os.tmpdir(), path.join(versions, "link"));
		writeFileSync(at("notes/a.md"), "old");

		const request = {
			requestId: randomUUID(),
			vaultPath: vault,
			session: "s1",
			path: at("notes/a.md"),
			seq: 1,
			submittedSha256: sha(Buffer.from("new")),
		};
		const committed = await recovery.savePageContent({
			request,
			content: "new",
		});
		assert.deepEqual(committed, {
			status: "committed",
			written: true,
			durable: true,
			history: { status: "notKept", reason: "unavailable" },
		});
		// It settles like any committed save. A stored answer, replayed or checked, asserts nothing (§7).
		assert.deepEqual(parseSaveOutcome(committed), committed);
		const stored = { ...committed, history: null };
		assert.deepEqual(
			await recovery.savePageContent({ request, content: "new" }),
			stored,
		);
		assert.deepEqual(await recovery.checkSaveOutcome({ request }), {
			state: "done",
			outcome: stored,
		});
		assert.equal(readFileSync(at("notes/a.md"), "utf8"), "new");
		assert.equal(
			(await save(vault, at("notes/a.md"), "new")).history,
			null,
			"a no-op asserts nothing",
		);
		assert.deepEqual(versionsOf(vault, at("notes/a.md")), []);
		const health = history.pageHistoryHealth({ vaultPath: vault });
		assert.equal(health.state, "notKeeping");
		assert.equal(health.reason, "unavailable");
		assert.deepEqual(health.attention.sort(), [
			".leadinglight/history/versions/link",
			".leadinglight/history/versions/not-a-location",
		]);
		assert.ok(
			existsSync(path.join(versions, "not-a-location")),
			"nothing is deleted",
		);

		if (asRoot) return;
		rmSync(path.join(versions, "not-a-location"), { recursive: true });
		rmSync(path.join(versions, "link"));
		chmodSync(versions, 0o555);
		try {
			assert.equal(
				(await save(vault, at("notes/a.md"), "newer")).status,
				"committed",
			);
			assert.equal(readFileSync(at("notes/a.md"), "utf8"), "newer");
			assert.equal(
				history.pageHistoryHealth({ vaultPath: vault }).reason,
				"unavailable",
			);
		} finally {
			chmodSync(versions, 0o755);
		}
		// A store that throws while being read is still never the page's answer.
		chmodSync(at(".leadinglight"), 0o000);
		try {
			assert.equal(
				(await save(vault, at("notes/a.md"), "newest")).status,
				"committed",
			);
			assert.equal(readFileSync(at("notes/a.md"), "utf8"), "newest");
		} finally {
			chmodSync(at(".leadinglight"), 0o755);
		}
	}));

test("a full store refuses capture until maintenance frees room, deleting only recognized files", () =>
	withVault(async (vault, at) => {
		let now = Date.UTC(2026, 9, 16, 12);
		const queue = [];
		const small = createDiskPageHistory({
			limits: { versions: 4 },
			now: () => now,
			schedule: (run) => queue.push(run),
		});
		const keep = (name, before) =>
			small.capture({
				vaultPath: vault,
				page: at(`notes/${name}.md`),
				before: Buffer.from(before),
				after: Buffer.from(""),
			});
		for (const before of ["one", "two", "three"]) {
			assert.equal(keep("p1", before), null);
			now += 120_000;
		}
		assert.equal(keep("p2", "other"), null);
		assert.deepEqual(keep("p3", "more"), { status: "notKept", reason: "full" });
		assert.equal(small.pageHistoryHealth({ vaultPath: vault }).reason, "full");

		const store = at(".leadinglight/history");
		const p1 = small.listPageVersions({
			vaultPath: vault,
			path: at("notes/p1.md"),
			cursor: null,
		}).versions;
		const oldest = path.join(store, "versions", ...p1[2].id.split("/"));
		writeFileSync(path.join(oldest, "extra.txt"), "not ours");
		writeFileSync(path.join(store, "versions", "note.txt"), "unknown file");
		const s0 = path.join(store, `copy-${randomUUID()}.json`);
		writeFileSync(s0, "{}");

		now += 200 * 24 * 3_600_000;
		for (const run of queue.splice(0)) run();
		assert.deepEqual(
			small
				.listPageVersions({
					vaultPath: vault,
					path: at("notes/p1.md"),
					cursor: null,
				})
				.versions.map((v) => v.id),
			[p1[0].id],
			"only the newest of p1 is left",
		);
		const left = readdirSync(path.join(store, "tmp"));
		assert.deepEqual(
			left,
			[`del-${p1[2].id.replace("/", "-")}`],
			"a folder with an unknown file stays in tmp",
		);
		assert.deepEqual(readdirSync(path.join(store, "tmp", left[0])), [
			"extra.txt",
		]);
		assert.ok(
			existsSync(s0) && existsSync(path.join(store, "versions", "note.txt")),
		);

		assert.equal(keep("p3", "more"), null);
		const health = small.pageHistoryHealth({ vaultPath: vault });
		assert.equal(health.state, "on");
		assert.ok(health.usedBytes >= Buffer.byteLength("unknown file"));
	}));

test("a version copy retry verifies its source first and never makes a second copy", () =>
	withVault(async (vault, at) => {
		writeFileSync(at("notes/a.md"), "kept words");
		await save(vault, at("notes/a.md"), "");
		const [row] = versionsOf(vault, at("notes/a.md"));
		const operationId = randomUUID();
		const created = copy(vault, row, null, operationId);
		assert.deepEqual(
			copy(vault, row, null, operationId),
			created,
			"a lost reply is answered again",
		);

		writeFileSync(payloadOf(vault, row.id), "kept wordz");
		assert.deepEqual(copy(vault, row, null, operationId), {
			status: "refused",
			reason: "damaged",
		});
		rmSync(path.dirname(payloadOf(vault, row.id)), { recursive: true });
		assert.deepEqual(copy(vault, row, null, operationId), {
			status: "refused",
			reason: "missing",
		});
		assert.equal(
			readFileSync(at("notes/a-2.md"), "utf8"),
			"kept words",
			"the earlier copy stays",
		);
		assert.deepEqual(readdirSync(at("notes")).sort(), [
			"a-2.md",
			"a.md",
			"deep",
		]);
	}));

// The frozen shared layout (m5-s1-cross-lane-contract-corrections.md), written here by hand.
function nativeVersion(vault, recordedPath, text, capturedAt, change = {}) {
	const payload = Buffer.from(text);
	const sha256 = sha(payload);
	const loc = sha(Buffer.from(recordedPath)).slice(0, 32);
	const name = `${String(capturedAt).padStart(13, "0")}-${sha256.slice(0, 16)}-a1b2c3`;
	const folder = path.join(
		vault,
		".leadinglight",
		"history",
		"versions",
		loc,
		name,
	);
	mkdirSync(folder, { recursive: true });
	writeFileSync(
		path.join(folder, "..", "location.json"),
		JSON.stringify({ recordedPath }),
	);
	writeFileSync(path.join(folder, "payload"), payload);
	const meta = {
		format: 1,
		capturedAt,
		reason: "bigChange",
		recordedPath,
		length: payload.length,
		sha256,
		...change,
	};
	writeFileSync(path.join(folder, "version.json"), JSON.stringify(meta));
	return { id: `${loc}/${name}`, sha256, folder };
}

test("a store in the shared layout reads the same; malformed entries are counted, never listed or rewritten", () =>
	withVault(async (vault, at) => {
		// Recent, so retention judges them by age the same way on any day this runs.
		const at0 = Date.now() - 60_000;
		const good = nativeVersion(vault, "notes/f.md", "shared text", at0);
		const future = nativeVersion(vault, "notes/f.md", "future", at0 + 1, {
			format: 2,
		});
		nativeVersion(vault, "notes/f.md", "loud", at0 + 2, {
			sha256: sha(Buffer.from("loud")).toUpperCase(),
		});
		nativeVersion(vault, "notes/f.md", "extra", at0 + 3, { note: "x" });
		nativeVersion(vault, "notes/f.md", "moved", at0 + 4, {
			recordedPath: "notes/other.md",
		});
		const futureMeta = readFileSync(path.join(future.folder, "version.json"));

		assert.deepEqual(
			versionsOf(vault, at("notes/f.md")).map((v) => v.id),
			[good.id],
		);
		assert.equal(
			history.readPageVersion({
				vaultPath: vault,
				id: good.id,
				sha256: good.sha256,
			}).text,
			"shared text",
		);
		assert.equal(
			copy(vault, { id: good.id, sha256: good.sha256 }).relativePath,
			"notes/f-2.md",
		);
		assert.equal(history.pageHistoryHealth({ vaultPath: vault }).unreadable, 4);
		writeFileSync(at("notes/f.md"), "now");
		await save(vault, at("notes/f.md"), "later");
		assert.ok(
			readFileSync(path.join(future.folder, "version.json")).equals(futureMeta),
			"never rewritten",
		);

		const tmp = at(".leadinglight/history/tmp");
		const lookalikes = ["0123456789ab.tmpv", `del-${good.id.split("/")[1]}`];
		for (const name of lookalikes) {
			mkdirSync(path.join(tmp, name), { recursive: true });
			utimesSync(path.join(tmp, name), new Date(0), new Date(0));
		}
		const health = history.pageHistoryHealth({ vaultPath: vault });
		assert.equal(health.reason, "unavailable");
		assert.deepEqual(
			health.attention.sort(),
			lookalikes.map((name) => `.leadinglight/history/tmp/${name}`).sort(),
		);
		history.maintain(vault);
		assert.ok(
			lookalikes.every((name) => existsSync(path.join(tmp, name))),
			"lookalikes are never deleted",
		);
	}));

test("cleaned leftovers free their room before any kept version is pruned; a failed cleanup still counts", () =>
	withVault(async (vault, at) => {
		let now = Date.UTC(2026, 9, 16, 12);
		const small = createDiskPageHistory({
			limits: { budgetBytes: 3000 },
			now: () => now,
			schedule: () => {},
		});
		const page = at("notes/p.md");
		for (const before of ["one", "two"]) {
			assert.equal(
				small.capture({
					vaultPath: vault,
					page,
					before: Buffer.from(before),
					after: Buffer.from(""),
				}),
				null,
			);
			now += 120_000;
		}
		const listed = () =>
			small.listPageVersions({ vaultPath: vault, path: page, cursor: null })
				.versions.length;
		const leftover = (name, extra) => {
			const dir = at(`.leadinglight/history/tmp/${name}.tmpv`);
			mkdirSync(dir);
			writeFileSync(path.join(dir, "payload"), Buffer.alloc(5000));
			if (extra) writeFileSync(path.join(dir, "junk"), Buffer.alloc(5000));
			utimesSync(dir, new Date(now - 7_200_000), new Date(now - 7_200_000));
			return dir;
		};

		const clean = leftover("a".repeat(32), false);
		small.maintain(vault);
		assert.equal(existsSync(clean), false);
		assert.equal(
			listed(),
			2,
			"nothing kept was pruned for room the cleanup already freed",
		);

		const stuck = leftover("b".repeat(32), true);
		small.maintain(vault);
		assert.deepEqual(readdirSync(stuck), ["junk"], "only recognized files go");
		assert.equal(
			listed(),
			1,
			"what could not be cleaned still counts against the budget",
		);
	}));

test("a new location's exact serialized bytes are reserved at the budget boundary", () =>
	withVault(async (vault, at) => {
		const now = Date.UTC(2026, 9, 16, 12);
		const recordedPath = 'notes/say "hi" ✓.md';
		const before = Buffer.from("earlier text");
		const need =
			before.length +
			Buffer.byteLength(
				JSON.stringify({
					format: 1,
					capturedAt: now,
					reason: "firstSave",
					recordedPath,
					length: before.length,
					sha256: sha(before),
				}),
			) +
			Buffer.byteLength(JSON.stringify({ recordedPath }));
		const keep = (budgetBytes) =>
			createDiskPageHistory({
				limits: { budgetBytes },
				now: () => now,
				schedule: () => {},
			}).capture({
				vaultPath: vault,
				page: at(recordedPath),
				before,
				after: Buffer.from(""),
			});

		assert.deepEqual(keep(need - 1), { status: "notKept", reason: "full" });
		assert.equal(keep(need), null);
		assert.equal(versionsOf(vault, at(recordedPath)).length, 1);
	}));

const DAY = 24 * 3_600_000;
/** Every file under `dir` with its exact bytes, so "unchanged" means byte-identical. */
const snapshot = (dir) =>
	Object.fromEntries(
		readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const file = path.join(entry.parentPath, entry.name);
				return [
					path.relative(dir, file),
					readFileSync(file).toString("base64"),
				];
			}),
	);

test("an unreadable record or an unknown folder stops maintenance, so nothing is pruned from a count with a gap", () =>
	withVault(async (vault, at) => {
		const t = Date.now();
		const later = createDiskPageHistory({
			now: () => t + 200 * DAY,
			schedule: () => {},
		});
		const page = at("notes/p.md");
		const oldest = nativeVersion(vault, "notes/p.md", "oldest", t - 3000);
		nativeVersion(vault, "notes/p.md", "older", t - 2000);
		const bad = nativeVersion(vault, "notes/p.md", "bad", t - 1000);
		writeFileSync(path.join(bad.folder, "version.json"), "{not json");
		const newest = nativeVersion(
			vault,
			"notes/p.md",
			"newest",
			t + 200 * DAY - 60_000,
		);
		const store = at(".leadinglight/history");
		const before = snapshot(store);

		if (!asRoot) {
			const record = path.join(oldest.folder, "version.json");
			const unreadable = (run) => {
				chmodSync(record, 0o000);
				try {
					return run();
				} finally {
					if (existsSync(record)) chmodSync(record, 0o644);
				}
			};
			unreadable(() => later.maintain(vault));
			assert.deepEqual(
				snapshot(store),
				before,
				"an unreadable record is not malformed",
			);
			const health = unreadable(() =>
				later.pageHistoryHealth({ vaultPath: vault }),
			);
			assert.equal(health.reason, "unavailable");
			assert.deepEqual(health.attention, [
				path.relative(vault, record).split(path.sep).join("/"),
			]);
		}

		const unknown = path.join(path.dirname(newest.folder), "not-a-version");
		mkdirSync(unknown);
		later.maintain(vault);
		assert.deepEqual(
			snapshot(store),
			before,
			"an unknown folder blocks pruning",
		);

		// With a complete count, the agreed policy still removes old and malformed versions.
		rmSync(unknown, { recursive: true });
		later.maintain(vault);
		assert.deepEqual(
			later
				.listPageVersions({ vaultPath: vault, path: page, cursor: null })
				.versions.map((v) => v.id),
			[newest.id],
		);
		assert.equal(existsSync(bad.folder), false);
	}));

test("a listed version whose record, location or folder changed is refused for preview and copy, and nothing is written", () =>
	withVault(async (vault, at) => {
		writeFileSync(at("notes/a.md"), "kept words");
		await save(vault, at("notes/a.md"), "");
		const [row] = versionsOf(vault, at("notes/a.md"));
		const dir = path.dirname(payloadOf(vault, row.id));
		const record = path.join(dir, "version.json");
		const location = path.join(dir, "..", "location.json");
		const original = readFileSync(record, "utf8");
		const ask = { vaultPath: vault, id: row.id, sha256: row.sha256 };
		const refused = (what) => {
			assert.deepEqual(
				history.readPageVersion(ask),
				{ status: "damaged" },
				what,
			);
			assert.deepEqual(
				copy(vault, row),
				{ status: "refused", reason: "damaged" },
				what,
			);
		};

		const meta = JSON.parse(original);
		for (const change of [
			{ recordedPath: "notes/deep/b.md" },
			{ capturedAt: meta.capturedAt + 1 },
		]) {
			writeFileSync(record, JSON.stringify({ ...meta, ...change }));
			refused(JSON.stringify(change));
		}
		writeFileSync(record, original);
		writeFileSync(
			location,
			JSON.stringify({ recordedPath: "notes/deep/b.md" }),
		);
		refused("a location record naming another page");
		rmSync(location);
		refused("no location record");
		writeFileSync(location, JSON.stringify({ recordedPath: "notes/a.md" }));
		writeFileSync(path.join(dir, "extra.txt"), "not ours");
		refused("an extra file in the version folder");
		rmSync(path.join(dir, "extra.txt"));

		assert.equal(
			history.readPageVersion(ask).text,
			"kept words",
			"restored, it reads again",
		);
		assert.deepEqual(readdirSync(at("notes")).sort(), ["a.md", "deep"]);
		assert.deepEqual(readdirSync(at("notes/deep")), []);
	}));

test("a payload read never takes more than its length and one byte, and an oversized version is refused unread", () =>
	withVault(async (vault, at) => {
		const file = path.join(vault, "grown");
		writeFileSync(file, Buffer.alloc(100, 1));
		const fd = openSync(file, "r");
		try {
			assert.equal(
				readExactly(fd, 36),
				null,
				"a longer file is not the recorded version",
			);
			assert.equal(
				readSync(fd, Buffer.alloc(100), 0, 100, null),
				100 - 37,
				"reading stopped one byte past the length",
			);
		} finally {
			closeSync(fd);
		}
		const whole = openSync(file, "r");
		try {
			assert.equal(readExactly(whole, 100)?.length, 100);
		} finally {
			closeSync(whole);
		}

		// Sparse, so the test never holds the large body; its record agrees with the size.
		const big = nativeVersion(
			vault,
			"notes/big.md",
			"small",
			Date.now() - 60_000,
		);
		const size = 10 * 1024 * 1024 + 1;
		truncateSync(path.join(big.folder, "payload"), size);
		const meta = JSON.parse(
			readFileSync(path.join(big.folder, "version.json"), "utf8"),
		);
		writeFileSync(
			path.join(big.folder, "version.json"),
			JSON.stringify({ ...meta, length: size }),
		);
		assert.deepEqual(
			history.readPageVersion({
				vaultPath: vault,
				id: big.id,
				sha256: big.sha256,
			}),
			{ status: "damaged" },
		);
		assert.deepEqual(readdirSync(at("notes")).sort(), ["deep"]);
	}));

test("a deletion leftover whose time is not a safe integer is never classified or deleted", () =>
	withVault(async (vault, at) => {
		const quiet = createDiskPageHistory({ schedule: () => {} });
		const name = `del-${"c".repeat(32)}-9999999999999999-${"d".repeat(16)}-abcdef`;
		const leftover = path.join(at(".leadinglight/history/tmp"), name);
		mkdirSync(leftover, { recursive: true });
		utimesSync(leftover, new Date(0), new Date(0));
		const health = quiet.pageHistoryHealth({ vaultPath: vault });
		assert.equal(health.reason, "unavailable");
		assert.deepEqual(health.attention, [`.leadinglight/history/tmp/${name}`]);
		quiet.maintain(vault);
		assert.ok(existsSync(leftover));
	}));
