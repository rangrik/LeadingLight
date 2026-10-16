import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	heldPathRefusal,
	diskSaveRecovery as recovery,
	runDiskSaveRecovery,
} from "./vault-api-save-recovery.ts";

// Real disposable files only; the native Rust tests stay authoritative for platform behavior.
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const asRoot = process.getuid?.() === 0;

async function withVault(check) {
	const vault = await mkdtemp(path.join(os.tmpdir(), "ll-save-recovery-"));
	mkdirSync(path.join(vault, "notes"));
	try {
		await check(vault, (relative) => path.join(vault, relative));
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
}

const envelope = (vault, page, content, seq = 1) => ({
	requestId: randomUUID(),
	vaultPath: vault,
	session: "s1",
	path: page,
	seq,
	submittedSha256: sha(content),
});
const save = (vault, page, content, seq) =>
	recovery.savePageContent({
		request: envelope(vault, page, content, seq),
		content,
	});
const stagingLeft = (folder) =>
	readdirSync(folder).filter((name) => name.startsWith(".leadinglight-"));

test("a save replaces the fixture file once and leaves no staging", () =>
	withVault(async (vault, at) => {
		const page = at("notes/a.md");
		writeFileSync(page, "old");
		const committed = await save(vault, page, "new");
		assert.equal(committed.status, "committed");
		assert.equal(committed.written, true);
		assert.equal(readFileSync(page, "utf8"), "new");
		assert.deepEqual(stagingLeft(at("notes")), []);
		assert.deepEqual(await save(vault, page, "new", 2), {
			status: "committed",
			written: false,
			durable: true,
			history: null,
		});
	}));

test(
	"a read-only page refuses without a hold and saves after repair; an unreadable one is readFailed",
	{ skip: asRoot },
	() =>
		withVault(async (vault, at) => {
			const page = at("notes/a.md");
			writeFileSync(page, "old");
			chmodSync(page, 0o444);
			assert.deepEqual(await save(vault, page, "new"), {
				status: "refused",
				reason: "readOnly",
			});
			assert.equal(heldPathRefusal([page]), null);
			chmodSync(page, 0o200);
			assert.deepEqual(await save(vault, page, "new"), {
				status: "refused",
				reason: "readFailed",
			});
			chmodSync(page, 0o644);
			assert.equal((await save(vault, page, "new")).status, "committed");
			assert.equal(readFileSync(page, "utf8"), "new");
		}),
);

test("a missing page or folder is held and never recreated; its copy lands beside it or asks for a folder", () =>
	withVault(async (vault, at) => {
		const gone = at("notes/gone.md");
		const request = envelope(vault, gone, "kept");
		const refusal = await recovery.savePageContent({
			request,
			content: "kept",
		});
		assert.equal(refusal.reason, "missing");
		assert.equal(existsSync(gone), false);
		assert.equal(heldPathRefusal([gone]), `held: ${gone}`);
		assert.equal(heldPathRefusal([at("notes")]), `held: ${at("notes")}`);
		writeFileSync(at("notes/other.md"), "old");
		assert.equal(
			(await save(vault, at("notes/other.md"), "saves")).status,
			"committed",
		);
		const copy = await recovery.saveDraftAsNewPage({
			request,
			draft: { seq: 1, content: "kept" },
			operationId: randomUUID(),
			folder: null,
		});
		assert.deepEqual(
			[copy.relativePath, readFileSync(copy.path, "utf8")],
			["notes/gone-2.md", "kept"],
		);

		const orphan = envelope(vault, at("lost/page.md"), "text");
		assert.equal(
			(await recovery.savePageContent({ request: orphan, content: "text" }))
				.reason,
			"parentMissing",
		);
		assert.equal(existsSync(at("lost")), false);
		assert.deepEqual(
			await recovery.saveDraftAsNewPage({
				request: orphan,
				draft: { seq: 1, content: "text" },
				operationId: randomUUID(),
				folder: null,
			}),
			{ status: "folderUnavailable", recordedFolder: at("lost") },
		);
		const into = (folder) =>
			recovery.saveDraftAsNewPage({
				request,
				draft: { seq: 1, content: "kept" },
				operationId: randomUUID(),
				folder,
			});
		assert.deepEqual(await into(".leadinglight"), {
			status: "refused",
			reason: "outsideVault",
		});
		assert.deepEqual(await into("../elsewhere"), {
			status: "refused",
			reason: "outsideVault",
		});
		assert.deepEqual(await into("later"), {
			status: "folderUnavailable",
			recordedFolder: `${vault}${path.sep}later`,
		});
	}));

test("links are held or refused and never followed", () =>
	withVault(async (vault, at) => {
		const outside = await mkdtemp(path.join(os.tmpdir(), "ll-outside-"));
		try {
			const target = path.join(outside, "target.md");
			writeFileSync(target, "outside");
			symlinkSync(target, at("notes/link.md"));
			assert.equal(
				(await save(vault, at("notes/link.md"), "new")).reason,
				"symlink",
			);
			assert.equal(readFileSync(target, "utf8"), "outside");
			writeFileSync(at("notes/a.md"), "old");
			linkSync(at("notes/a.md"), at("notes/twin.md"));
			assert.equal(
				(await save(vault, at("notes/a.md"), "new")).reason,
				"linked",
			);
			assert.equal(readFileSync(at("notes/twin.md"), "utf8"), "old");
			symlinkSync(outside, at("escape"));
			assert.deepEqual(await save(vault, at("escape/target.md"), "new"), {
				status: "refused",
				reason: "outsideVault",
			});
			assert.deepEqual(
				await save(vault, `${at("notes")}/../notes/a.md`, "new"),
				{ status: "refused", reason: "outsideVault" },
			);
			assert.equal(readFileSync(target, "utf8"), "outside");
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	}));

test("a copy never clobbers, a retry returns the same owned file, and release proves its current bytes", () =>
	withVault(async (vault, at) => {
		writeFileSync(at("notes/gone-2.md"), "someone else's");
		const request = envelope(vault, at("notes/gone.md"), "text");
		await recovery.savePageContent({ request, content: "text" });
		const operationId = randomUUID();
		const copyArgs = {
			request,
			draft: { seq: 2, content: "draft" },
			operationId,
			folder: null,
		};
		const copy = await recovery.saveDraftAsNewPage(copyArgs);
		assert.equal(copy.path, at("notes/gone-3.md"));
		assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), copy);
		assert.equal(
			existsSync(
				path.join(
					vault,
					".leadinglight",
					"history",
					`copy-${operationId}.json`,
				),
			),
			true,
		);
		assert.equal(
			readFileSync(
				path.join(vault, ".leadinglight", "history", ".gitignore"),
				"utf8",
			),
			"*\n",
		);
		assert.equal(readFileSync(at("notes/gone-2.md"), "utf8"), "someone else's");

		const release = {
			request,
			actionId: randomUUID(),
			confirmed: { seq: 2, contentSha256: sha("draft") },
			operationId,
		};
		writeFileSync(copy.path, "edited in place");
		assert.deepEqual(await recovery.releaseHoldWithCopy(release), {
			status: "refused",
			reason: "copyChanged",
		});
		unlinkSync(copy.path);
		writeFileSync(copy.path, "draft");
		assert.deepEqual(await recovery.releaseHoldWithCopy(release), {
			status: "refused",
			reason: "copyNotOwned",
		});
		assert.equal(
			heldPathRefusal([at("notes/gone.md")]),
			`held: ${at("notes/gone.md")}`,
		);
	}));

test("release settles a held page once its own copy is proved", () =>
	withVault(async (vault, at) => {
		const request = envelope(vault, at("notes/gone.md"), "text");
		await recovery.savePageContent({ request, content: "text" });
		const operationId = randomUUID();
		await recovery.saveDraftAsNewPage({
			request,
			draft: { seq: 1, content: "text" },
			operationId,
			folder: null,
		});
		const release = {
			request,
			actionId: randomUUID(),
			confirmed: { seq: 1, contentSha256: sha("text") },
			operationId,
		};
		const resolved = {
			status: "resolved",
			actionId: release.actionId,
			holdRetired: true,
			leftovers: [],
		};
		// The same bytes from another draft are not this copy.
		assert.deepEqual(
			await recovery.releaseHoldWithCopy({
				...release,
				actionId: randomUUID(),
				confirmed: { seq: 2, contentSha256: sha("text") },
			}),
			{ status: "refused", reason: "copyChanged" },
		);
		assert.deepEqual(await recovery.releaseHoldWithCopy(release), resolved);
		assert.deepEqual(await recovery.releaseHoldWithCopy(release), resolved);
		assert.equal(heldPathRefusal([at("notes/gone.md")]), null);
		assert.deepEqual(await recovery.checkSaveOutcome({ request }), {
			state: "retired",
			terminal: "refused",
			resolved: true,
		});
	}));

// Seam: the intent names the staged file before any name is taken, so a lost final record never loses the copy.
test("a retry finds its published copy by identity and never adopts or deletes another file", () =>
	withVault(async (vault, at) => {
		const request = envelope(vault, at("notes/gone.md"), "text");
		await recovery.savePageContent({ request, content: "text" });
		const operationId = randomUUID();
		const copyArgs = {
			request,
			draft: { seq: 1, content: "draft" },
			operationId,
			folder: null,
		};
		const copy = await recovery.saveDraftAsNewPage(copyArgs);
		const intentFile = readdirSync(
			path.join(vault, ".leadinglight", "history"),
		).find((name) => name.includes(operationId));
		const intentPath = path.join(vault, ".leadinglight", "history", intentFile);
		const forget = () =>
			writeFileSync(
				intentPath,
				JSON.stringify({
					...JSON.parse(readFileSync(intentPath, "utf8")),
					candidate: null,
				}),
			);
		forget();
		assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), {
			...copy,
			durable: false,
		});
		// Like native, the recorded candidate is the resolved path.
		const candidate = realpathSync(copy.path);
		assert.equal(
			JSON.parse(readFileSync(intentPath, "utf8")).candidate,
			candidate,
		);

		unlinkSync(copy.path);
		writeFileSync(copy.path, "someone else's");
		assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), {
			status: "uncertain",
			candidatePath: candidate,
		});
		forget();
		assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), {
			status: "uncertain",
			candidatePath: null,
		});
		assert.equal(readFileSync(copy.path, "utf8"), "someone else's");
		assert.deepEqual(stagingLeft(at("notes")), []);
	}));

// Seam: recovery re-checks the copy's folder before any read. Catches a retry or keep-copy reading through a folder swapped for an outside link.
test("a copy retry and keep-copy never read through a folder swapped for an outside link", () =>
	withVault(async (vault, at) => {
		const outside = await mkdtemp(path.join(os.tmpdir(), "ll-outside-"));
		try {
			const request = envelope(vault, at("notes/gone.md"), "text");
			await recovery.savePageContent({ request, content: "text" });
			const operationId = randomUUID();
			const copyArgs = {
				request,
				draft: { seq: 1, content: "text" },
				operationId,
				folder: null,
			};
			assert.equal(
				(await recovery.saveDraftAsNewPage(copyArgs)).status,
				"created",
			);
			const moved = path.join(outside, "notes");
			renameSync(at("notes"), moved);
			symlinkSync(moved, at("notes"));

			const candidate = path.join(realpathSync(vault), "notes", "gone-2.md");
			assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), {
				status: "uncertain",
				candidatePath: candidate,
			});
			const release = {
				request,
				actionId: randomUUID(),
				confirmed: { seq: 1, contentSha256: sha("text") },
				operationId,
			};
			assert.deepEqual(await recovery.releaseHoldWithCopy(release), {
				status: "refused",
				reason: "copyNotOwned",
			});
			const intentPath = path.join(
				vault,
				".leadinglight",
				"history",
				`copy-${operationId}.json`,
			);
			writeFileSync(
				intentPath,
				JSON.stringify({
					...JSON.parse(readFileSync(intentPath, "utf8")),
					candidate: null,
				}),
			);
			assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), {
				status: "uncertain",
				candidatePath: null,
			});
			assert.deepEqual(readdirSync(moved).sort(), ["gone-2.md"]);
			assert.equal(readFileSync(path.join(moved, "gone-2.md"), "utf8"), "text");
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	}));

// Seam: the copy intent is on disk before the copy is published. Catches publishing a copy whose record a retry needs could be lost.
test(
	"a copy is not published while its intent cannot be written, and a retry then creates it",
	{ skip: asRoot },
	() =>
		withVault(async (vault, at) => {
			const request = envelope(vault, at("notes/gone.md"), "text");
			await recovery.savePageContent({ request, content: "text" });
			const history = path.join(vault, ".leadinglight", "history");
			mkdirSync(history, { recursive: true });
			writeFileSync(path.join(history, ".gitignore"), "*\n");
			chmodSync(history, 0o555);
			const copyArgs = {
				request,
				draft: { seq: 1, content: "text" },
				operationId: randomUUID(),
				folder: null,
			};
			try {
				assert.equal(
					(await recovery.saveDraftAsNewPage(copyArgs)).status,
					"failed",
				);
				assert.deepEqual(readdirSync(at("notes")), []);
				assert.deepEqual(readdirSync(history), [".gitignore"]);
			} finally {
				chmodSync(history, 0o755);
			}
			assert.deepEqual(await recovery.saveDraftAsNewPage(copyArgs), {
				status: "created",
				path: path.join(vault, "notes", "gone-2.md"),
				relativePath: "notes/gone-2.md",
				durable: true,
			});
		}),
);

// Seam: the route answers Check and Discard for a root it never saw, as native needs no vault for them.
// Catches a vanished fixture leaving its unknown save with no way out, or a write slipping past.
test("an unseen unavailable root can be checked and discarded at the route, and never written", async () => {
	const vault = path.join(os.tmpdir(), `ll-absent-${randomUUID()}`);
	const route = (command, body) => runDiskSaveRecovery(command, body);
	const request = envelope(vault, path.join(vault, "notes", "a.md"), "text");
	const confirmed = { seq: 1, contentSha256: request.submittedSha256 };
	const discard = { request, actionId: randomUUID(), confirmed };
	const refused = (reason) => ({
		payload: { status: "refused", reason },
		statusCode: 200,
	});

	assert.deepEqual(await route("check_save_outcome", { request }), {
		payload: { state: "voided" },
		statusCode: 200,
	});
	const resolved = {
		status: "resolved",
		actionId: discard.actionId,
		holdRetired: false,
		leftovers: [],
	};
	assert.deepEqual(await route("discard_hold", discard), {
		payload: resolved,
		statusCode: 200,
	});
	assert.deepEqual(await route("discard_hold", discard), {
		payload: resolved,
		statusCode: 200,
	});
	assert.deepEqual(await route("check_save_outcome", { request }), {
		payload: { state: "voided" },
		statusCode: 200,
	});

	const malformed = { ...request, requestId: request.requestId.toUpperCase() };
	assert.deepEqual(await route("check_save_outcome", { request: malformed }), {
		payload: { state: "mismatch" },
		statusCode: 200,
	});
	assert.deepEqual(
		await route("discard_hold", { ...discard, request: malformed }),
		refused("requestMismatch"),
	);
	assert.deepEqual(
		await route("discard_hold", {
			...discard,
			request: { ...request, seq: 2 },
		}),
		refused("requestMismatch"),
	);
	assert.deepEqual(
		await route("discard_hold", { ...discard, actionId: "not-an-action" }),
		refused("actionMismatch"),
	);
	assert.deepEqual(
		await route("discard_hold", {
			...discard,
			confirmed: { seq: 2, contentSha256: sha("other") },
		}),
		refused("actionMismatch"),
	);
	assert.equal(
		(
			await route("check_save_outcome", {
				request: { ...request, extra: true },
			})
		).statusCode,
		400,
	);

	const notDisk = { payload: { error: "notDiskVault" }, statusCode: 404 };
	const fresh = envelope(vault, path.join(vault, "notes", "b.md"), "text");
	assert.deepEqual(
		await route("save_page_content", { request: fresh, content: "text" }),
		notDisk,
	);
	assert.deepEqual(
		await route("save_draft_as_new_page", {
			request,
			draft: { seq: 1, content: "text" },
			operationId: randomUUID(),
			folder: null,
		}),
		notDisk,
	);
	assert.deepEqual(
		await route("release_hold_with_copy", {
			...discard,
			actionId: randomUUID(),
			operationId: randomUUID(),
		}),
		notDisk,
	);
	assert.equal(
		existsSync(vault),
		false,
		"nothing was created for the absent root",
	);
});
