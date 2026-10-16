import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs, {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	checkPath,
	classifyPath,
	displayName,
	nameOk,
	runMemoryBackup,
	serializeManifest,
	skipDir,
	validateManifest,
} from "../src/mock-tauri/mock-backup.ts";
import { createDiskBackup, runDiskBackup } from "./vault-api-backup.ts";
import {
	createDiskPageHistory,
	diskSaveRecovery,
} from "./vault-api-save-recovery.ts";

// Real disposable folders only; the native Rust tests stay authoritative for platform behaviour.
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MANIFEST = "leadinglight-backup.json";
const BACKUP = "start_workspace_backup";
const INSPECT = "start_backup_inspection";
const RESTORE = "start_backup_restore";
const MARKER = ".leadinglight-restore-unfinished";

/** Fault injection into a real filesystem operation, restored before the next test. */
async function withFsFault(t, name, implementation, check) {
	t.mock.method(fs, name, implementation);
	syncBuiltinESMExports();
	try {
		return await check();
	} finally {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	}
}

async function withRoots(check) {
	const base = await mkdtemp(path.join(os.tmpdir(), "ll-backup-"));
	const vault = path.join(base, "Notes");
	const out = path.join(base, "out");
	mkdirSync(vault);
	mkdirSync(out);
	try {
		await check({ base, vault, out });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
}
const put = (root, relative, bytes) => {
	const target = path.join(root, ...relative.split("/"));
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, bytes);
	return target;
};
/** Every regular file under a root, by `/` path, with its bytes. */
function files(root, folder = "") {
	const found = {};
	for (const name of readdirSync(path.join(root, folder))) {
		const relative = folder ? `${folder}/${name}` : name;
		const stats = statSync(path.join(root, relative), {
			throwIfNoEntry: false,
		});
		if (stats?.isDirectory()) Object.assign(found, files(root, relative));
		else if (stats?.isFile())
			found[relative] = readFileSync(path.join(root, relative));
	}
	return found;
}
/** Starts and waits; refusals come back as the start answer. */
async function run(bridge, command, args) {
	const operationId = randomUUID();
	const started = bridge.start(command, { operationId, ...args });
	if (started.status !== "started") return started;
	await bridge.settled(operationId);
	return bridge.status({ operationId }).result;
}
const manifestOf = (folder) =>
	JSON.parse(readFileSync(path.join(folder, MANIFEST), "utf8"));
const manifestSha = (folder) => sha(readFileSync(path.join(folder, MANIFEST)));

/** The shared fixture: BOM, CRLF, every byte value, a nested view, a real saved version, exclusions. */
async function seed(vault) {
	put(vault, "notes/plan.md", "# Plan\n\nWords.\n");
	put(vault, "notes/windows.md", "\ufeff# Windows\r\n\r\nCRLF lines.\r\n");
	put(
		vault,
		"assets/every-byte.bin",
		Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)),
	);
	put(vault, ".laputa/views/board.json", '{"kind":"board"}\n');
	for (const excluded of [
		".git/HEAD",
		".leadinglight-staging/half.md",
		".laputa-cache.json",
		"notes/.DS_Store",
	])
		put(vault, excluded, "excluded\n");
	put(
		vault,
		".leadinglight/trash/0123456789abcdef0123456789abcdef/payload",
		"# Gone\n",
	);
	const page = put(vault, "notes/history.md", "# History\n\nEarlier words.\n");
	const saved = await diskSaveRecovery.savePageContent({
		request: {
			requestId: randomUUID(),
			vaultPath: vault,
			session: "backup-test",
			path: page,
			seq: 1,
			submittedSha256: sha("# History\n\nLater words.\n"),
		},
		content: "# History\n\nLater words.\n",
	});
	assert.equal(saved.status, "committed");
	const loc = readdirSync(
		path.join(vault, ".leadinglight/history/versions"),
	)[0];
	// History never lists this one, so a backup counts it as skipped.
	put(
		vault,
		`.leadinglight/history/versions/${loc}/${Date.now()}-0000000000000000-000000/version.json`,
		"{}",
	);
	symlinkSync("notes", path.join(vault, "linked"));
	put(vault, "odd:name.md", "a colon is not portable\n");
	return loc;
}

// Seam: the walk, the copy and publication. Catches an excluded artifact copied, a link followed,
// a skipped version or a gap not counted, changed bytes, or a manifest that is not last and alone.
test("a backup copies exact bytes and listable versions, excludes internals, and counts every gap and skip", () =>
	withRoots(async ({ vault, out }) => {
		const loc = await seed(vault);
		const seen = [];
		const bridge = createDiskBackup({
			chunkBytes: 64,
			step: (event) => {
				if (event.at === "file" && seen.length === 0)
					seen.push(bridge.status({ operationId: current }));
			},
		});
		const current = randomUUID();
		assert.deepEqual(
			bridge.start(BACKUP, {
				operationId: current,
				vaultPath: vault,
				destination: out,
			}),
			{ status: "started" },
		);
		await bridge.settled(current);
		const result = bridge.status({ operationId: current }).result;
		// Status and progress were answered while the copy ran.
		assert.equal(seen[0].state, "running");
		assert.equal(seen[0].phase, "copying");
		assert.ok(seen[0].progress.totalFiles >= 6);

		assert.equal(result.status, "incomplete");
		assert.deepEqual(result.gaps.counts, { link: 1, notText: 1 });
		assert.deepEqual(result.gaps.sample.map((gap) => gap.path).sort(), [
			"linked",
			"odd:name.md",
		]);
		assert.equal(result.versionsSkipped, 1);
		assert.equal(result.trashItemsNotIncluded, 1);
		assert.equal(result.durable, true);
		assert.equal(path.dirname(result.folder), out);
		assert.match(
			result.folderName,
			/^Notes backup \d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/,
		);
		assert.deepEqual(readdirSync(result.folder).sort(), [
			MANIFEST,
			"workspace",
		]);

		const manifest = manifestOf(result.folder);
		const copied = files(path.join(result.folder, "workspace"));
		const source = files(vault);
		const listed = manifest.files.map((file) => file.path);
		assert.deepEqual(Object.keys(copied).sort(), [...listed].sort());
		assert.deepEqual(
			listed,
			[...listed].sort((a, b) =>
				Buffer.compare(Buffer.from(a), Buffer.from(b)),
			),
		);
		const times = new Set();
		for (const file of manifest.files) {
			assert.ok(copied[file.path].equals(source[file.path]), file.path);
			assert.equal(file.sha256, sha(source[file.path]));
			// As native: pages keep their own time, saved versions take the backup folder's.
			if (file.path.startsWith(".leadinglight/")) times.add(file.modifiedMs);
			else
				assert.equal(
					file.modifiedMs,
					Math.trunc(statSync(path.join(vault, file.path)).mtimeMs),
				);
		}
		assert.equal(times.size, 1);
		const versionFiles = listed.filter((file) =>
			file.startsWith(".leadinglight/"),
		);
		assert.equal(versionFiles.length, 3);
		assert.ok(
			versionFiles.includes(
				`.leadinglight/history/versions/${loc}/location.json`,
			),
		);
		for (const kept of [
			"notes/windows.md",
			"assets/every-byte.bin",
			".laputa/views/board.json",
			"notes/history.md",
		])
			assert.ok(listed.includes(kept), kept);
		for (const excluded of [
			".git/HEAD",
			".laputa-cache.json",
			"notes/.DS_Store",
			"linked",
			"odd:name.md",
		])
			assert.ok(!listed.includes(excluded), excluded);
		assert.ok(
			!listed.some(
				(file) =>
					file.includes("trash") ||
					file.startsWith(".leadinglight-") ||
					file.includes(".gitignore"),
			),
		);
		assert.deepEqual(manifest.gaps, [
			{ path: "linked", reason: "link" },
			{ path: "odd:name.md", reason: "notText" },
		]);
		assert.equal(
			validateManifest(readFileSync(path.join(result.folder, MANIFEST))).ok,
			true,
		);
	}));

// Seam: inspection and restore against the bytes on disk. Catches an unchecked file passing,
// unlisted files restored, times lost, the marker left behind, or restored history not listable.
test("inspection checks every byte; restore makes a new folder from re-verified bytes and keeps times", () =>
	withRoots(async ({ vault, out }) => {
		await seed(vault);
		const bridge = createDiskBackup();
		const backup = await run(bridge, BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		put(backup.folder, "workspace/notes/extra.md", "not listed\n");
		const inspected = await run(bridge, INSPECT, { backupPath: backup.folder });
		assert.deepEqual(
			{ ...inspected, createdAt: "", appVersion: "" },
			{
				status: "ok",
				manifestSha256: manifestSha(backup.folder),
				createdAt: "",
				appVersion: "",
				workspaceName: "Notes",
				backupStatus: "incomplete",
				files: backup.files,
				bytes: backup.bytes,
				gaps: 2,
				extraFiles: 1,
			},
		);
		const restored = await run(bridge, RESTORE, {
			backupPath: backup.folder,
			manifestSha256: inspected.manifestSha256,
			parent: out,
			name: "Notes restored",
		});
		assert.deepEqual(restored, {
			status: "restored",
			folder: path.join(out, "Notes restored"),
			folderName: "Notes restored",
			files: backup.files,
			bytes: backup.bytes,
			durable: true,
			timesKept: true,
		});
		const manifest = manifestOf(backup.folder);
		const tree = files(restored.folder);
		assert.deepEqual(
			Object.keys(tree).sort(),
			manifest.files.map((file) => file.path).sort(),
		);
		for (const file of manifest.files) {
			assert.equal(sha(tree[file.path]), file.sha256);
			assert.ok(
				Math.abs(
					statSync(path.join(restored.folder, file.path)).mtimeMs -
						file.modifiedMs,
				) < 1,
				file.path,
			);
		}
		// The restored workspace's own history lists the restored version.
		const history = createDiskPageHistory({ schedule: () => {} });
		const listed = history.listPageVersions({
			vaultPath: restored.folder,
			path: path.join(restored.folder, "notes/history.md"),
			cursor: null,
		});
		assert.equal(listed.versions.length, 1);
		assert.equal(
			sha(Buffer.from("# History\n\nEarlier words.\n")),
			listed.versions[0].sha256,
		);
		assert.deepEqual(
			await run(bridge, RESTORE, {
				backupPath: backup.folder,
				manifestSha256: inspected.manifestSha256,
				parent: out,
				name: "Notes restored",
			}),
			{ status: "nameTaken" },
		);
	}));

// Seam: start guards. Catches a write before refusal, a backup inside a workspace, a restore into
// the backup, an unsafe name, a second job, or an id reused for other arguments.
test("refusals come before any write; a retained id answers the same and refuses other arguments", () =>
	withRoots(async ({ base, vault, out }) => {
		put(vault, "a.md", "a\n");
		const file = put(base, "file.txt", "x");
		let release;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		const bridge = createDiskBackup({
			step: (event) => (event.at === "count" ? held : undefined),
		});
		const refused = (command, args) =>
			bridge.start(command, { operationId: randomUUID(), ...args });
		const before = readdirSync(out);
		assert.deepEqual(
			refused(BACKUP, { vaultPath: path.join(base, "none"), destination: out }),
			{ status: "refused", reason: "notWorkspace" },
		);
		assert.deepEqual(
			refused(BACKUP, {
				vaultPath: vault,
				destination: path.join(base, "none"),
			}),
			{ status: "refused", reason: "destinationMissing" },
		);
		assert.deepEqual(refused(BACKUP, { vaultPath: vault, destination: file }), {
			status: "refused",
			reason: "destinationNotFolder",
		});
		assert.deepEqual(
			refused(BACKUP, { vaultPath: vault, destination: vault }),
			{ status: "refused", reason: "destinationInWorkspace" },
		);
		assert.deepEqual(
			bridge.start(BACKUP, {
				operationId: "not-a-uuid",
				vaultPath: vault,
				destination: out,
			}),
			{ status: "refused", reason: "operationMismatch" },
		);

		const id = randomUUID();
		assert.deepEqual(
			bridge.start(BACKUP, {
				operationId: id,
				vaultPath: vault,
				destination: out,
			}),
			{ status: "started" },
		);
		assert.deepEqual(
			bridge.start(BACKUP, {
				operationId: id,
				vaultPath: vault,
				destination: out,
			}),
			{ status: "started" },
		);
		assert.deepEqual(
			bridge.start(BACKUP, {
				operationId: id,
				vaultPath: vault,
				destination: base,
			}),
			{ status: "refused", reason: "operationMismatch" },
		);
		assert.deepEqual(refused(INSPECT, { backupPath: out }), {
			status: "refused",
			reason: "busy",
		});
		release();
		await bridge.settled(id);
		const done = bridge.status({ operationId: id });
		assert.equal(done.state, "finished");
		assert.deepEqual(
			bridge.start(BACKUP, {
				operationId: id,
				vaultPath: vault,
				destination: out,
			}),
			{ status: "finished", result: done.result },
		);

		const backup = done.result.folder;
		const restore = (args) =>
			refused(RESTORE, {
				backupPath: backup,
				manifestSha256: "0".repeat(64),
				parent: out,
				name: "R",
				...args,
			});
		assert.deepEqual(
			refused(INSPECT, { backupPath: path.join(base, "none") }),
			{ status: "refused", reason: "backupMissing" },
		);
		assert.deepEqual(refused(INSPECT, { backupPath: file }), {
			status: "refused",
			reason: "backupNotFolder",
		});
		assert.deepEqual(restore({ parent: path.join(base, "none") }), {
			status: "refused",
			reason: "parentMissing",
		});
		assert.deepEqual(restore({ parent: file }), {
			status: "refused",
			reason: "parentNotFolder",
		});
		assert.deepEqual(restore({ parent: path.join(vault) }), {
			status: "refused",
			reason: "parentInWorkspace",
		});
		assert.deepEqual(restore({ parent: path.join(backup, "workspace") }), {
			status: "refused",
			reason: "parentInBackup",
		});
		for (const name of [
			"",
			".hidden",
			"a/b",
			"a\\b",
			"a:b",
			" padded",
			"padded ",
			"tab\tname",
			"x".repeat(256),
			"..",
			".",
		])
			assert.deepEqual(
				restore({ name }),
				{ status: "refused", reason: "nameInvalid" },
				JSON.stringify(name),
			);
		assert.deepEqual(
			readdirSync(out).sort(),
			[...before, path.basename(backup)].sort(),
		);
		assert.deepEqual(bridge.status({ operationId: randomUUID() }), {
			state: "unknown",
		});
		assert.deepEqual(bridge.cancel({ operationId: id }), { accepted: false });
	}));

// Seam: cancel and the completion point. Catches a cancel that deletes a stranger's file, claims
// nothing is left when something is, or turns a finished backup into a cancelled one.
test("a cancel before completion removes only our files and names what is left; after completion it is refused", () =>
	withRoots(async ({ vault, out }) => {
		put(vault, "a.md", "a".repeat(100));
		put(vault, "b.md", "b".repeat(100));
		let id = randomUUID();
		const bridge = createDiskBackup({
			chunkBytes: 16,
			step: (event) => {
				if (event.at === "chunk")
					assert.deepEqual(bridge.cancel({ operationId: id }), {
						accepted: true,
					});
			},
		});
		bridge.start(BACKUP, {
			operationId: id,
			vaultPath: vault,
			destination: out,
		});
		await bridge.settled(id);
		assert.deepEqual(bridge.status({ operationId: id }).result, {
			status: "cancelled",
			leftover: null,
		});
		assert.deepEqual(readdirSync(out), []);

		// A stranger's file dropped into our folder stays, and the folder is named.
		id = randomUUID();
		const strangers = createDiskBackup({
			chunkBytes: 16,
			step: (event) => {
				if (event.at !== "chunk") return;
				const folder = path.join(out, readdirSync(out)[0]);
				if (!existsSync(path.join(folder, "stranger.txt")))
					writeFileSync(path.join(folder, "stranger.txt"), "mine");
				strangers.cancel({ operationId: id });
			},
		});
		strangers.start(BACKUP, {
			operationId: id,
			vaultPath: vault,
			destination: out,
		});
		await strangers.settled(id);
		const left = strangers.status({ operationId: id }).result;
		assert.equal(left.status, "cancelled");
		assert.deepEqual(readdirSync(left.leftover), ["stranger.txt"]);
		await rm(left.leftover, { recursive: true });

		// A cancel that arrives just before publication wins; one after completion is refused.
		id = randomUUID();
		const racing = createDiskBackup({
			step: (event) => {
				if (event.at === "beforePublish") racing.cancel({ operationId: id });
			},
		});
		racing.start(BACKUP, {
			operationId: id,
			vaultPath: vault,
			destination: out,
		});
		await racing.settled(id);
		assert.deepEqual(racing.status({ operationId: id }).result, {
			status: "cancelled",
			leftover: null,
		});
		assert.deepEqual(readdirSync(out), []);
		const plain = createDiskBackup();
		id = randomUUID();
		plain.start(BACKUP, {
			operationId: id,
			vaultPath: vault,
			destination: out,
		});
		await plain.settled(id);
		assert.deepEqual(plain.cancel({ operationId: id }), { accepted: false });
		assert.equal(plain.status({ operationId: id }).result.status, "complete");
	}));

// Seam: source and output identity. Catches a changing file copied as if steady, a stranger's
// manifest replaced, or a write that follows a folder swapped for a link outside.
test("a changing file becomes a gap; a stranger's manifest or a swapped folder fails without writing elsewhere", () =>
	withRoots(async ({ base, vault, out }) => {
		const grow = put(vault, "grow.md", "x".repeat(40));
		put(vault, "steady.md", "steady\n");
		const changing = createDiskBackup({
			chunkBytes: 8,
			step: (event) => {
				if (event.at === "chunk" && event.path === "grow.md")
					appendFileSync(grow, "y");
			},
		});
		const result = await run(changing, BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		assert.equal(result.status, "incomplete");
		assert.deepEqual(result.gaps.counts, { changing: 1 });
		assert.deepEqual(
			manifestOf(result.folder).files.map((file) => file.path),
			["steady.md"],
		);
		await rm(result.folder, { recursive: true });

		const stranger = createDiskBackup({
			step: (event) => {
				if (event.at === "beforePublish")
					writeFileSync(
						path.join(out, readdirSync(out)[0], MANIFEST),
						"theirs",
					);
			},
		});
		const blocked = await run(stranger, BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		assert.deepEqual(
			{ ...blocked, leftover: null },
			{
				status: "failed",
				reason: "destinationChanged",
				path: null,
				leftover: null,
			},
		);
		assert.equal(
			readFileSync(path.join(blocked.leftover, MANIFEST), "utf8"),
			"theirs",
		);
		assert.deepEqual(readdirSync(blocked.leftover), [MANIFEST]);
		await rm(blocked.leftover, { recursive: true });

		const outside = path.join(base, "outside");
		mkdirSync(outside);
		const swap = createDiskBackup({
			step: (event) => {
				if (event.at !== "file" || event.path !== "grow.md") return;
				const folder = path.join(out, readdirSync(out)[0]);
				renameSync(path.join(folder, "workspace"), path.join(folder, "moved"));
				symlinkSync(outside, path.join(folder, "workspace"));
			},
		});
		const swapped = await run(swap, BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		assert.equal(swapped.status, "failed");
		assert.equal(swapped.reason, "destinationChanged");
		assert.equal(swapped.leftover, path.join(out, readdirSync(out)[0]));
		assert.deepEqual(readdirSync(outside), []);
	}));

test("history enumeration spends one cumulative entry budget before creating output", () =>
	withRoots(async ({ vault, out }) => {
		put(vault, "a.md", "a");
		for (const digit of ["a", "b"])
			put(
				vault,
				`.leadinglight/history/versions/${digit.repeat(32)}/location.json`,
				"{}",
			);
		const result = await run(
			createDiskBackup({ limits: { entries: 5 } }),
			BACKUP,
			{ vaultPath: vault, destination: out },
		);
		assert.deepEqual(result, {
			status: "failed",
			reason: "tooLarge",
			path: null,
			leftover: null,
		});
		assert.deepEqual(readdirSync(out), []);
	}));

test("partial history listing failures do not refund entries already visited", (t) =>
	withRoots(async ({ vault, out }) => {
		put(vault, "a.md", "a");
		for (const digit of ["a", "b"])
			put(
				vault,
				`.leadinglight/history/versions/${digit.repeat(32)}/location.json`,
				"{}",
			);
		const realStore = fs.realpathSync(
			path.join(vault, ".leadinglight/history/versions"),
		);
		const openDir = fs.opendirSync;
		const result = await withFsFault(
			t,
			"opendirSync",
			(folder, ...args) => {
				const handle = openDir(folder, ...args);
				if (path.dirname(folder) !== realStore) return handle;
				let reads = 0;
				return {
					readSync: () => {
						if (reads++ === 1)
							throw Object.assign(new Error("fixture listing failed"), {
								code: "EIO",
							});
						return handle.readSync();
					},
					closeSync: () => handle.closeSync(),
				};
			},
			() =>
				run(createDiskBackup({ limits: { entries: 6 } }), BACKUP, {
					vaultPath: vault,
					destination: out,
				}),
		);
		assert.deepEqual(result, {
			status: "failed",
			reason: "tooLarge",
			path: null,
			leftover: null,
		});
		assert.deepEqual(readdirSync(out), []);
	}));

test("an unreadable history store is disclosed; an absent store is not an omission", (t) =>
	withRoots(async ({ vault, out }) => {
		put(vault, "a.md", "a");
		const absent = await run(createDiskBackup(), BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		assert.equal(absent.status, "complete");
		await rm(absent.folder, { recursive: true });
		const store = path.join(vault, ".leadinglight/history/versions");
		mkdirSync(store, { recursive: true });
		const realStore = fs.realpathSync(store);
		const openDir = fs.opendirSync;
		const result = await withFsFault(
			t,
			"opendirSync",
			(folder, ...args) => {
				if (folder === realStore)
					throw Object.assign(new Error("fixture unreadable"), {
						code: "EACCES",
					});
				return openDir(folder, ...args);
			},
			() =>
				run(createDiskBackup(), BACKUP, { vaultPath: vault, destination: out }),
		);
		assert.equal(result.status, "incomplete");
		assert.deepEqual(result.gaps.counts, { unreadable: 1 });
		assert.deepEqual(result.gaps.sample, [
			{ path: ".leadinglight/history/versions", reason: "unreadable" },
		]);
	}));

test("history paths count toward the shared path-byte budget before output creation", () =>
	withRoots(async ({ vault, out }) => {
		await seed(vault);
		const result = await run(
			createDiskBackup({ limits: { totalPathBytes: 250 } }),
			BACKUP,
			{ vaultPath: vault, destination: out },
		);
		assert.deepEqual(result, {
			status: "failed",
			reason: "tooLarge",
			path: null,
			leftover: null,
		});
		assert.deepEqual(readdirSync(out), []);
	}));

test("backup and restore can cancel during verification of empty files", () =>
	withRoots(async ({ vault, out }) => {
		for (const name of ["a.md", "b.md", "c.md"]) put(vault, name, "");
		const backup = await run(createDiskBackup(), BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		for (const command of [BACKUP, RESTORE]) {
			const operationId = randomUUID();
			const checked = [];
			const bridge = createDiskBackup({
				step: (event) => {
					if (event.at !== "check") return;
					checked.push(event.path);
					assert.equal(bridge.cancel({ operationId }).accepted, true);
				},
			});
			const args =
				command === BACKUP
					? { vaultPath: vault, destination: out }
					: {
							backupPath: backup.folder,
							manifestSha256: manifestSha(backup.folder),
							parent: out,
							name: "Cancelled empty",
						};
			bridge.start(command, { operationId, ...args });
			await bridge.settled(operationId);
			assert.deepEqual(checked, ["a.md"]);
			assert.deepEqual(bridge.status({ operationId }).result, {
				status: "cancelled",
				leftover: null,
			});
			assert.deepEqual(readdirSync(out), [path.basename(backup.folder)]);
		}
	}));

test("a cancelled restore re-marks its folder when final removal fails, without replacing a stranger's marker", (t) =>
	withRoots(async ({ vault, out }) => {
		put(vault, "a.md", "saved words\n");
		const backup = await run(createDiskBackup(), BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		const manifestSha256 = manifestSha(backup.folder);
		const remove = fs.rmdirSync;
		for (const foreignMarker of [false, true]) {
			const name = foreignMarker ? "Foreign marker" : "Kept folder";
			const target = path.join(out, name);
			const targetDisk = path.join(fs.realpathSync(out), name);
			const operationId = randomUUID();
			let reachedFinalRemove = false;
			const bridge = createDiskBackup({
				step: (event) => {
					if (event.at === "beforeMarker") bridge.cancel({ operationId });
				},
			});
			await withFsFault(
				t,
				"rmdirSync",
				(folder, ...args) => {
					if (folder === targetDisk) {
						reachedFinalRemove = true;
						assert.ok(!existsSync(path.join(target, MARKER)));
						put(target, foreignMarker ? MARKER : "stranger.txt", "theirs");
					}
					return remove(folder, ...args);
				},
				async () => {
					bridge.start(RESTORE, {
						operationId,
						backupPath: backup.folder,
						manifestSha256,
						parent: out,
						name,
					});
					await bridge.settled(operationId);
				},
			);
			assert.ok(reachedFinalRemove);
			assert.deepEqual(bridge.status({ operationId }).result, {
				status: "cancelled",
				leftover: target,
			});
			assert.equal(
				readFileSync(path.join(target, MARKER), "utf8"),
				foreignMarker ? "theirs" : `{"manifestSha256":"${manifestSha256}"}\n`,
			);
			assert.ok(!existsSync(path.join(target, "a.md")));
		}
	}));

// Seam: restore's distrust of the inspected backup and its marker. Catches a changed backup
// restored, an overwrite, a marker removed while data remains, or a restore claimed after a marker fault.
test("restore refuses changed or damaged backups, never overwrites, and keeps the marker with retained data", () =>
	withRoots(async ({ vault, out }) => {
		put(vault, "a.md", "aaaa\n");
		put(vault, "b.md", "bbbb\n");
		const bridge = createDiskBackup();
		const backup = await run(bridge, BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		const inspected = await run(bridge, INSPECT, { backupPath: backup.folder });
		const sha256 = inspected.manifestSha256;
		const restoreWith = (hooks, name) =>
			run(createDiskBackup({ step: hooks }), RESTORE, {
				backupPath: backup.folder,
				manifestSha256: sha256,
				parent: out,
				name,
			});

		assert.deepEqual(
			await run(bridge, RESTORE, {
				backupPath: backup.folder,
				manifestSha256: "f".repeat(64),
				parent: out,
				name: "R1",
			}),
			{
				status: "backupChanged",
				problems: {
					total: 1,
					counts: { hashMismatch: 1 },
					sample: [{ path: MANIFEST, reason: "hashMismatch" }],
				},
				leftover: null,
			},
		);
		assert.ok(!existsSync(path.join(out, "R1")));

		// A file changed after inspection, same size: found while copying, everything ours removed.
		const bFile = path.join(backup.folder, "workspace", "b.md");
		const changed = await restoreWith((event) => {
			if (event.at === "file" && event.path === "a.md")
				writeFileSync(bFile, "BBBB\n");
		}, "R2");
		assert.deepEqual(changed, {
			status: "backupChanged",
			problems: {
				total: 1,
				counts: { hashMismatch: 1 },
				sample: [{ path: "b.md", reason: "hashMismatch" }],
			},
			leftover: null,
		});
		assert.ok(!existsSync(path.join(out, "R2")));

		// With a stranger's file inside, the folder stays, and so does the unfinished marker.
		const kept = await restoreWith((event) => {
			if (event.at === "file" && event.path === "a.md")
				writeFileSync(path.join(out, "R3", "stranger.txt"), "theirs");
		}, "R3");
		assert.equal(kept.status, "backupChanged");
		assert.equal(kept.leftover, path.join(out, "R3"));
		assert.deepEqual(readdirSync(kept.leftover).sort(), [
			".leadinglight-restore-unfinished",
			"stranger.txt",
		]);
		writeFileSync(bFile, "bbbb\n");

		// A name already taken inside the new folder (a case fold on some disks) fails without overwrite.
		const taken = await restoreWith((event) => {
			if (event.at === "file" && event.path === "a.md")
				writeFileSync(path.join(out, "R4", "b.md"), "theirs");
		}, "R4");
		assert.deepEqual(
			{ ...taken, leftover: null },
			{ status: "failed", reason: "io", path: "b.md", leftover: null },
		);
		assert.equal(readFileSync(path.join(out, "R4", "b.md"), "utf8"), "theirs");
		assert.ok(
			existsSync(path.join(out, "R4", ".leadinglight-restore-unfinished")),
		);
		assert.ok(!existsSync(path.join(out, "R4", "a.md")));

		// A marker that is not ours at completion: never reported as restored.
		const marker = await restoreWith((event) => {
			if (event.at !== "beforeMarker") return;
			unlinkSync(path.join(out, "R5", ".leadinglight-restore-unfinished"));
			writeFileSync(
				path.join(out, "R5", ".leadinglight-restore-unfinished"),
				"theirs",
			);
		}, "R5");
		assert.deepEqual(marker, {
			status: "failed",
			reason: "io",
			path: ".leadinglight-restore-unfinished",
			leftover: path.join(out, "R5"),
		});

		// A damaged manifest is refused before anything is created.
		writeFileSync(path.join(backup.folder, MANIFEST), "{}");
		const damaged = await run(bridge, RESTORE, {
			backupPath: backup.folder,
			manifestSha256: sha(Buffer.from("{}")),
			parent: out,
			name: "R6",
		});
		assert.equal(damaged.status, "damaged");
		assert.ok(!existsSync(path.join(out, "R6")));
	}));

// Seam: inspection of an untrusted folder. Catches a damaged file reported as ok or a link read.
test("inspection reports size, hash, missing and link problems, and a missing manifest as not a backup", () =>
	withRoots(async ({ vault, out }) => {
		for (const name of ["a.md", "b.md", "c.md", "d.md"])
			put(vault, name, `${name}\n`);
		const bridge = createDiskBackup();
		const backup = await run(bridge, BACKUP, {
			vaultPath: vault,
			destination: out,
		});
		const workspace = path.join(backup.folder, "workspace");
		writeFileSync(path.join(workspace, "a.md"), "a.md longer\n");
		writeFileSync(path.join(workspace, "b.md"), "B.MD\n");
		unlinkSync(path.join(workspace, "c.md"));
		unlinkSync(path.join(workspace, "d.md"));
		// Five bytes long, as the listed file, so the size check passes and the link itself is judged.
		put(backup.folder, "d1", "d.md\n");
		symlinkSync("../d1", path.join(workspace, "d.md"));
		const damaged = await run(bridge, INSPECT, { backupPath: backup.folder });
		assert.equal(damaged.status, "damaged");
		assert.deepEqual(damaged.problems.counts, {
			sizeMismatch: 1,
			hashMismatch: 1,
			missing: 1,
			notRegularFile: 1,
		});
		assert.deepEqual(await run(bridge, INSPECT, { backupPath: vault }), {
			status: "notBackup",
		});
	}));

// Seam: the shared rules, mirrored from native rules.rs and manifest.rs. Catches the two sides
// disagreeing about a path, a name, a forged manifest or an unsafe number.
test("paths, names and manifests are judged exactly as native judges them", () => {
	for (const [path, fault] of [
		["notes/a.md", null],
		["a\\b", "notText"],
		["C:/x", "notText"],
		["a/../b", "notText"],
		["a//b", "notText"],
		["tab\tname", "notText"],
		["", "notText"],
		["x".repeat(1025), "tooLong"],
		[Array(65).fill("a").join("/"), "tooDeep"],
	])
		assert.equal(checkPath(path), fault, path);
	for (const [path, kind] of [
		["notes/a.md", "user"],
		[".git/HEAD", "excluded"],
		["a/.git/x", "excluded"],
		[".leadinglight-stage/x", "excluded"],
		[".laputa-cache.json", "excluded"],
		["notes/.laputa-cache.json", "user"],
		["x/.DS_Store", "excluded"],
		[".leadinglight", "excluded"],
		[
			".leadinglight/trash/0123456789abcdef0123456789abcdef/payload",
			"excluded",
		],
		[
			`.leadinglight/history/versions/${"a".repeat(32)}/location.json`,
			"version",
		],
		[
			`.leadinglight/history/versions/${"a".repeat(32)}/1-${"b".repeat(16)}-cccccc/payload`,
			"version",
		],
		[
			`.leadinglight/history/versions/${"a".repeat(32)}/1-${"b".repeat(16)}-cccccc/extra`,
			"excluded",
		],
		// A case-insensitive disk resolves these to the reserved names, so they are excluded too.
		[".GIT/HEAD", "excluded"],
		["notes/.Git/x", "excluded"],
		[".LeadingLight-Staging/x", "excluded"],
		[".LAPUTA-CACHE.json", "excluded"],
		["x/.ds_store", "excluded"],
		[
			".LeadingLight/trash/0123456789abcdef0123456789abcdef/payload",
			"excluded",
		],
		// Only the exact store spelling carries versions.
		[
			`.LeadingLight/history/versions/${"a".repeat(32)}/location.json`,
			"excluded",
		],
		// Ordinary names keep their case, and only A-Z fold: a long s is not an s.
		["Notes/Plan.md", "user"],
		["x/.Dſ_Store", "user"],
	])
		assert.equal(classifyPath(path), kind, path);
	assert.equal(skipDir(".LeadingLight"), true);
	assert.equal(skipDir("Notes"), false);
	assert.equal(nameOk("\ufeffName"), true);
	assert.equal(nameOk("Name\u3000"), false);
	assert.equal(displayName(" .My:Notes/x "), "My-Notes-x");
	assert.equal(displayName("..."), "Workspace");

	const base = {
		format: "leadinglight-backup",
		version: 1,
		appVersion: "0.5.0",
		createdAt: "2026-10-16T21:32:05Z",
		workspaceName: "Notes",
		status: "complete",
		files: [{ path: "a.md", bytes: 2, sha256: "a".repeat(64), modifiedMs: 1 }],
		gaps: [],
		gapsTotal: 0,
		versionsSkipped: 0,
		trashItemsNotIncluded: 0,
		totalFiles: 1,
		totalBytes: 2,
	};
	const check = (value) =>
		validateManifest(
			Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
		);
	const problems = (value) => {
		const result = check(value);
		return result.ok ? null : result.problems.counts;
	};
	assert.equal(check(serializeManifest(base)).ok, true);
	assert.deepEqual(problems({ ...base, version: 2 }), {
		unsupportedVersion: 1,
	});
	assert.deepEqual(problems({ ...base, version: undefined }), {
		unsupportedVersion: 1,
	});
	assert.deepEqual(problems({ ...base, extra: 1 }), { manifestInvalid: 1 });
	assert.deepEqual(
		problems(
			JSON.stringify(base).replace(
				'"gapsTotal":0',
				'"gapsTotal":0,"gapsTotal":0',
			),
		),
		{ manifestInvalid: 1 },
	);
	assert.deepEqual(
		problems(JSON.stringify(base).replace('"bytes":2', '"bytes":2.0')),
		{ manifestInvalid: 1 },
	);
	assert.deepEqual(problems(`\ufeff${JSON.stringify(base)}`), {
		manifestInvalid: 1,
	});
	assert.deepEqual(problems({ ...base, status: "incomplete" }), {
		manifestInvalid: 1,
	});
	assert.deepEqual(
		problems({
			...base,
			gaps: [{ path: "x", reason: "link" }],
			gapsTotal: 2,
			status: "incomplete",
		}),
		{ manifestInvalid: 1 },
	);
	assert.deepEqual(problems({ ...base, totalBytes: 3 }), {
		manifestInvalid: 1,
	});
	assert.deepEqual(problems({ ...base, createdAt: "yesterday" }), {
		manifestInvalid: 1,
	});
	assert.deepEqual(problems({ ...base, workspaceName: ".hidden" }), {
		manifestInvalid: 1,
	});
	assert.deepEqual(
		problems({ ...base, files: [{ ...base.files[0], modifiedMs: 2 ** 53 }] }),
		{ manifestInvalid: 1 },
	);
	const listed = (paths) => ({
		...base,
		files: paths.map((path) => ({ ...base.files[0], path })),
		totalFiles: paths.length,
		totalBytes: 2 * paths.length,
	});
	assert.deepEqual(
		problems(
			listed([
				"../x",
				"C:x",
				".git/x",
				".leadinglight/trash/a/payload",
				"ok.md",
			]),
		),
		{ badPath: 4 },
	);
	assert.deepEqual(problems(listed(["a.md", "a.md"])), { duplicatePath: 1 });
	assert.deepEqual(problems(listed(["a", "a/b.md"])), { pathConflict: 1 });
});

// Seam: the bounded registry and the browser's no-disk preview. Catches an evicted id answered as
// if known, or the in-memory preview claiming a backup it cannot make.
test("only the newest 16 results are kept, and the in-memory preview never claims a backup", () =>
	withRoots(async ({ out }) => {
		const bridge = createDiskBackup();
		const ids = [];
		for (let n = 0; n < 17; n += 1) {
			const operationId = randomUUID();
			ids.push(operationId);
			bridge.start(INSPECT, { operationId, backupPath: out });
			await bridge.settled(operationId);
		}
		assert.deepEqual(bridge.status({ operationId: ids[0] }), {
			state: "unknown",
		});
		assert.deepEqual(bridge.status({ operationId: ids[16] }), {
			state: "finished",
			kind: "inspect",
			result: { status: "notBackup" },
		});
		assert.deepEqual(
			runMemoryBackup(BACKUP, {
				operationId: randomUUID(),
				vaultPath: "/Users/mock",
				destination: "/tmp",
			}),
			{ status: "refused", reason: "unavailable" },
		);
		assert.deepEqual(
			runMemoryBackup("get_backup_operation", { operationId: randomUUID() }),
			{ state: "unknown" },
		);
		assert.deepEqual(
			runMemoryBackup("cancel_backup_operation", { operationId: randomUUID() }),
			{ accepted: false },
		);
		assert.equal(
			(await runDiskBackup(BACKUP, { operationId: randomUUID() })).statusCode,
			400,
		);
	}));

// Seam: the cross-reader helper native runs. Catches a helper that touches unmarked folders, or a
// bridge-written backup the bridge itself cannot inspect and restore byte for byte.
test("the cross-reader helper refuses unmarked folders and round-trips the shared fixture", () =>
	withRoots(async ({ vault, out }) => {
		const helper = fileURLToPath(
			new URL("./leadinglight-backup-cross-reader.mjs", import.meta.url),
		);
		const ask = (request) => {
			const run = spawnSync(
				process.execPath,
				["--experimental-strip-types", "--no-warnings", helper],
				{ input: JSON.stringify(request), encoding: "utf8" },
			);
			return { code: run.status, answer: JSON.parse(run.stdout) };
		};
		assert.deepEqual(ask({ op: "seed", vault }).code, 2);
		writeFileSync(
			path.join(vault, ".leadinglight-synthetic-vault"),
			"leadinglight synthetic vault\n",
		);
		writeFileSync(
			path.join(out, ".leadinglight-synthetic-output"),
			"leadinglight synthetic output\n",
		);
		const seeded = ask({ op: "seed", vault });
		assert.equal(seeded.code, 0);
		const backup = ask({ op: "backup", vault, destination: out }).answer;
		assert.equal(backup.result.status, "incomplete");
		assert.deepEqual(backup.manifest.gaps, seeded.answer.expected.gaps);
		assert.equal(
			backup.manifest.versionsSkipped,
			seeded.answer.expected.versionsSkipped,
		);
		assert.equal(
			backup.manifest.trashItemsNotIncluded,
			seeded.answer.expected.trashItemsNotIncluded,
		);
		const expected = seeded.answer.expected.files
			.map(({ path: relative, sha256 }) => [relative, sha256])
			.sort();
		assert.deepEqual(
			backup.manifest.files.map((file) => [file.path, file.sha256]).sort(),
			expected,
		);
		const inspected = ask({ op: "inspect", backup: backup.result.folder })
			.answer.result;
		assert.equal(inspected.manifestSha256, backup.manifestSha256);
		const restored = ask({
			op: "restore",
			backup: backup.result.folder,
			manifestSha256: backup.manifestSha256,
			parent: out,
			name: "Round trip",
		}).answer.result;
		assert.equal(restored.status, "restored");
		const tree = ask({ op: "tree", root: restored.folder }).answer.tree;
		assert.deepEqual(
			tree.files.map((file) => [file.path, file.sha256]).sort(),
			expected,
		);
		assert.deepEqual(tree.links, []);
		assert.equal(ask({ op: "tree", root: path.dirname(out) }).code, 2);
	}));
