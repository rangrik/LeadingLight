import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "vite";
import { parseMarkdownFile } from "./vault-api-data.ts";
import { vaultApiPlugin } from "./vault-api-plugin.ts";
import { runVaultCommand } from "./vault-api-commands.ts";
import { RENAME_REFUSED_PREFIX } from "../src/leadinglight/rename/renameRefusal.ts";
import {
	autoRenameUntitledOnDisk,
	moveNoteToFolderOnDisk,
	renameNoteFilenameOnDisk,
	renameNoteOnDisk,
} from "./vault-api-rename.ts";
import { VAULT_API_MARKER } from "../src/mock-tauri/mock-save-recovery.ts";

const titleSourceContract = JSON.parse(
	readFileSync(new URL("../src/shared/titleSourceContract.json", import.meta.url), "utf8"),
);

// The browser bridge must name pages exactly as the native parser does.
test("dev vault titles follow the shared title-source contract", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "tolaria-title-test-"));
	try {
		for (const fixture of titleSourceContract.fixtures) {
			const file = path.join(dir, fixture.filename);
			writeFileSync(file, fixture.content);
			const entry = parseMarkdownFile(file);
			assert.equal(entry?.title, fixture.title, fixture.name);
			assert.equal(entry?.titleSource, fixture.titleSource, fixture.name);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

function sendRequest({ port, route, args = {}, method = "POST" }) {
	const routePath =
		method === "GET" ? `${route}?${new URLSearchParams(args)}` : route;
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: "127.0.0.1",
				port,
				path: routePath,
				method,
				headers: { "Content-Type": "application/json" },
			},
			(res) => {
				let body = "";
				res.on("data", (chunk) => {
					body += chunk.toString();
				});
				res.on("end", () =>
					resolve({ status: res.statusCode, body: JSON.parse(body) }),
				);
				res.on("error", reject);
			},
		);
		req.on("error", reject);
		req.end(method === "GET" ? undefined : JSON.stringify(args));
	});
}

async function withVault(check) {
	const vault = await mkdtemp(path.join(os.tmpdir(), "tolaria-api-test-"));
	const server = await createServer({
		configFile: false,
		plugins: [vaultApiPlugin()],
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", port: 0 },
	});
	try {
		await server.listen();
		const { port } = server.httpServer.address();
		const note = path.join(vault, "original.md");
		const link = path.join(vault, "link.md");
		const content = "---\nstatus: active\n---\n# Original\nBody text\n";
		const api = (route, args, method) =>
			sendRequest({ port, route, args, method });
		await api("/api/vault/save", { path: note, content });
		await api("/api/vault/save", {
			path: link,
			content: "# Links\n[[Original|label]] [[original]]\n",
		});
		await check({
			vault,
			note,
			link,
			content,
			api,
		});
	} catch (error) {
		throw new Error("Dev vault contract check failed", { cause: error });
	} finally {
		await server.close();
		await rm(vault, { recursive: true, force: true });
	}
}

// The browser bridge must read stars the way native does, or seeded Favorites vanish on reload.
test("dev vault keeps stars on same-title pages across a save and reload", () =>
	withVault(async ({ api, vault }) => {
		const harbor = path.join(vault, "harbor", "lantern.md");
		const garden = path.join(vault, "garden", "lantern.md");
		const loose = path.join(vault, "loose.md");
		await api("/api/vault/save", { path: harbor, content: "---\n_favorite: true\n_favorite_index: 0\n---\n# Lantern\n" });
		await api("/api/vault/save", { path: garden, content: "---\n_favorite: \"yes\"\n_favorite_index: 1\n---\n# Lantern\n" });
		await api("/api/vault/save", { path: loose, content: "---\n_favorite: false\n_favorite_index: 4\n---\nBody\n" });
		const stars = async () =>
			new Map(
				(await api("/api/vault/list", { path: vault, reload: true })).body
					.filter((entry) => [harbor, garden, loose].includes(entry.path))
					.map((entry) => [entry.path, [entry.favorite, entry.favoriteIndex]]),
			);
		const expected = new Map([[harbor, [true, 0]], [garden, [true, 1]], [loose, [false, 4]]]);
		assert.deepEqual(await stars(), expected);
		// An ordinary edit keeps the keys, so the stars survive it.
		await api("/api/vault/save", { path: harbor, content: "---\n_favorite: true\n_favorite_index: 0\n---\n# Lantern\n\nMore.\n" });
		assert.deepEqual(await stars(), expected);
	}));

test("dev vault read routes support GET and POST", () =>
	withVault(async ({ api, vault, note, content }) => {
		assert.equal((await api("/api/vault/ping", {}, "GET")).body.ok, true);
		for (const method of ["GET", "POST"]) {
			assert.equal(
				(await api("/api/vault/content", { path: note }, method)).body.content,
				content,
			);
			assert.equal(
				(await api("/api/vault/list", { path: vault }, method)).body.length,
				2,
			);
			assert.equal(
				(await api("/api/vault/entry", { path: note }, method)).body.title,
				"Original",
			);
			assert.equal(
				new Map(
					Object.entries(
						(await api("/api/vault/all-content", { path: vault }, method)).body,
					),
				).get(note),
				content,
			);
			assert.equal(
				(
					await api(
						"/api/vault/search",
						{ vault_path: vault, query: "Body" },
						method,
					)
				).body.results.length,
				1,
			);
		}
	}));

// Like native: the title goes to front matter (never the H1) and every legacy target follows.
test("dev vault renames follow native targets and receipts and keep save/delete responses", () =>
	withVault(async ({ api, vault, note, link }) => {
		const renamed = await api("/api/vault/rename", {
			old_path: note,
			new_title: "Updated",
			vault_path: vault,
			open_paths: [link],
		});
		assert.equal(renamed.body.updated_files, 1);
		assert.equal(renamed.body.source_content, "---\nstatus: active\ntitle: Updated\n---\n# Original\nBody text\n");
		assert.deepEqual(renamed.body.updated_open_pages, [{
			path: link,
			before_content: "# Links\n[[Original|label]] [[original]]\n",
			content: "# Links\n[[updated|label]] [[updated]]\n",
		}]);
		assert.equal(
			(await api("/api/vault/content", { path: link }, "GET")).body.content,
			"# Links\n[[updated|label]] [[updated]]\n",
		);
		const moved = await api("/api/vault/rename-filename", {
			old_path: renamed.body.new_path,
			new_filename_stem: "moved",
			vault_path: vault,
		});
		assert.equal(moved.body.updated_files, 1);
		assert.equal(
			(await api("/api/vault/content", { path: link }, "GET")).body.content,
			"# Links\n[[moved|label]] [[moved]]\n",
		);
		assert.equal(
			(
				await api("/api/vault/save", {
					path: moved.body.new_path,
					content: "# Saved",
				})
			).body,
			null,
		);
		assert.equal(
			(
				await api("/api/vault/command", {
					cmd: "get_note_content",
					args: { path: moved.body.new_path },
				})
			).body.content,
			"# Saved",
		);
		assert.equal(
			(await api("/api/vault/delete", { path: moved.body.new_path })).body,
			moved.body.new_path,
		);
	}));

// Each S0 command has its own route, a held page refuses legacy writes, and served pages say a disk is reachable.
test("dev vault save recovery routes answer native shapes and guard a held page", () =>
	withVault(async ({ api, vault, note }) => {
		assert.deepEqual(vaultApiPlugin().transformIndexHtml()[0].attrs, { name: VAULT_API_MARKER, content: "disk" });
		const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
		const envelope = (page, content, vaultPath = vault) => ({
			requestId: randomUUID(), vaultPath, session: "s1", path: page, seq: 1, submittedSha256: sha(content),
		});
		const request = envelope(note, "# Saved\n");
		const saved = await api("/api/vault/save-page-content", { request, content: "# Saved\n" });
		assert.deepEqual([saved.status, saved.body.status, readFileSync(note, "utf8")], [200, "committed", "# Saved\n"]);
		assert.equal((await api("/api/vault/check-save-outcome", { request })).body.state, "done");
		const gone = path.join(vault, "gone.md");
		const held = await api("/api/vault/save-page-content", { request: envelope(gone, "text"), content: "text" });
		assert.equal(held.body.reason, "missing");
		assert.equal((await api("/api/vault/save", { path: gone, content: "recreated" })).status, 409);
		assert.equal(existsSync(gone), false);
		const elsewhere = envelope("/not-on-disk/page.md", "x", "/not-on-disk");
		assert.deepEqual((await api("/api/vault/save-page-content", { request: elsewhere, content: "x" })).body, { error: "notDiskVault" });
		assert.equal((await api("/api/vault/save-page-content", { request: { ...request, extra: true }, content: "# Saved\n" })).status, 400);
	}));

test("dev vault error responses preserve status codes", () =>
	withVault(async ({ api }) => {
		assert.equal((await api("/api/vault/content", {})).status, 400);
		assert.equal((await api("/api/vault/content", {}, "PUT")).status, 405);
		assert.equal(
			(await api("/api/vault/command", { cmd: "unsupported", args: {} }))
				.status,
			404,
		);
		assert.equal((await api("/api/vault/command", {})).status, 400);
		assert.equal((await api("/api/vault/save", {})).status, 400);
		assert.equal((await api("/api/vault/delete", {})).status, 400);
	}));

// --- Managed rename bridge leaf: the same exact links and receipts as native, no server needed ---

async function withDiskVault(check) {
	const vault = realpathSync(await mkdtemp(path.join(os.tmpdir(), "leadinglight-rename-bridge-")));
	const file = (relative) => path.join(vault, relative);
	const write = (relative, content) => {
		mkdirSync(path.dirname(file(relative)), { recursive: true });
		writeFileSync(file(relative), content);
	};
	const read = (relative) => readFileSync(file(relative), "utf8");
	try {
		await check({ vault, file, write, read });
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
}

const COMMENTARY = "---\n_leadinglight_commentary:\n  version: 1\n  captures:\n    - exact: W1BsYW5dXQ==\n---\n# Commentary on Plan\n\n[Source](../Topics/plan.md)\n\nThoughts.\n";

test("managed rename bridge: filename rename keeps the Source link with an exact receipt", () =>
	withDiskVault(async ({ vault, file, write, read }) => {
		write("Topics/plan.md", "# Plan\n");
		write("Notes/commentary.md", COMMENTARY);
		write("Notes/legacy.md", "See [[Topics/plan]] and [[plan]].\n");
		write("Other/same-title.md", "[Plan](../Elsewhere/plan.md)\n");
		const gone = file("Notes/closed-elsewhere.md");
		const response = renameNoteFilenameOnDisk({
			vault_path: vault,
			old_path: file("Topics/plan.md"),
			new_filename_stem: "goals",
			open_paths: [file("Notes/commentary.md"), gone],
		});
		const after = COMMENTARY.replace("../Topics/plan.md", "../Topics/goals.md");
		assert.equal(response.statusCode, 200);
		assert.deepEqual(response.payload, {
			new_path: file("Topics/goals.md"),
			updated_files: 2,
			failed_updates: 0,
			source_before_content: "# Plan\n",
			source_content: "# Plan\n",
			updated_open_pages: [{ path: file("Notes/commentary.md"), before_content: COMMENTARY, content: after }],
			unrefreshed_open_paths: [gone],
		});
		assert.equal(read("Notes/commentary.md"), after);
		assert.equal(read("Notes/legacy.md"), "See [[Topics/goals]] and [[Topics/goals]].\n");
		assert.equal(read("Other/same-title.md"), "[Plan](../Elsewhere/plan.md)\n");
		assert.equal(existsSync(file("Topics/plan.md")), false);
	}));

test("managed rename bridge: title rename takes the free candidate and rebases self-links", () =>
	withDiskVault(async ({ vault, file, write, read }) => {
		write("Topics/plan.md", "# Another plan\n");
		write("Topics/draft.md", "---\ntitle: Draft\n---\n# Draft\n\n[Top](./draft.md#draft) [Neighbor](./plan.md)\n");
		write("Notes/commentary.md", "# C\n\n[Source](../Topics/draft.md)\n");
		const response = renameNoteOnDisk({ vault_path: vault, old_path: file("Topics/draft.md"), new_title: "Plan" });
		assert.equal(response.statusCode, 200);
		assert.equal(response.payload.new_path, file("Topics/plan-2.md"));
		assert.equal(read("Topics/plan-2.md"), "---\ntitle: Plan\n---\n# Draft\n\n[Top](./plan-2.md#draft) [Neighbor](./plan.md)\n");
		assert.equal(read("Notes/commentary.md"), "# C\n\n[Source](../Topics/plan-2.md)\n");
		assert.equal(read("Topics/plan.md"), "# Another plan\n");
	}));

test("managed rename bridge: folder move and auto rename keep ordinary links both ways", () =>
	withDiskVault(async ({ vault, file, write, read }) => {
		write("Topics/plan.md", "# Plan\n");
		write("Notes/commentary.md", COMMENTARY);
		mkdirSync(file("Archive/2026"), { recursive: true });
		const moved = moveNoteToFolderOnDisk({ vault_path: vault, old_path: file("Notes/commentary.md"), folder_path: "Archive/2026" });
		assert.equal(moved.statusCode, 200);
		assert.equal(read("Archive/2026/commentary.md"), COMMENTARY.replace("../Topics/plan.md", "../../Topics/plan.md"));

		write("untitled-note-1700000000.md", "# Harbor Plan\n");
		write("Notes/on-untitled.md", "[Source](../untitled-note-1700000000.md)\n");
		const auto = autoRenameUntitledOnDisk({ vault_path: vault, note_path: file("untitled-note-1700000000.md") });
		assert.equal(auto.payload.new_path, file("harbor-plan.md"));
		assert.equal(read("Notes/on-untitled.md"), "[Source](../harbor-plan.md)\n");
		assert.equal(autoRenameUntitledOnDisk({ vault_path: vault, note_path: file("harbor-plan.md") }).payload, null);
	}));

test("managed rename bridge: refusals happen before any change; unparseable pages are reported", () =>
	withDiskVault(async ({ vault, file, write, read }) => {
		write("Topics/plan.md", "# Plan\n");
		write("Topics/goals.md", "# Goals\n");
		write("Notes/html.md", "<a href='../Topics/plan.md'>Plan</a> [[plan]]\n");
		const outside = renameNoteFilenameOnDisk({ vault_path: vault, old_path: file("Topics/plan.md"), new_filename_stem: "aims", open_paths: ["/elsewhere/page.md"] });
		assert.equal(outside.statusCode, 400);
		const taken = renameNoteFilenameOnDisk({ vault_path: vault, old_path: file("Topics/plan.md"), new_filename_stem: "goals" });
		// Amendment B1: a refusal before publication, with the source in place, is marked explicit.
		assert.deepEqual([taken.statusCode, taken.payload], [409, { error: `${RENAME_REFUSED_PREFIX}A note with that name already exists` }]);
		const gone = renameNoteFilenameOnDisk({ vault_path: vault, old_path: file("Topics/gone.md"), new_filename_stem: "aims" });
		assert.ok(!gone.payload.error.startsWith(RENAME_REFUSED_PREFIX), "a missing source proves nothing");
		assert.equal(renameNoteFilenameOnDisk({ vault_path: vault, old_path: file("Topics/plan.md"), new_filename_stem: "a:b" }).statusCode, 400);
		assert.equal(read("Topics/plan.md"), "# Plan\n");
		const renamed = renameNoteFilenameOnDisk({ vault_path: vault, old_path: file("Topics/plan.md"), new_filename_stem: "aims" });
		// HTML is never rewritten; its legacy wikilink still follows, and the page is reported.
		assert.equal(read("Notes/html.md"), "<a href='../Topics/plan.md'>Plan</a> [[Topics/aims]]\n");
		assert.deepEqual([renamed.payload.updated_files, renamed.payload.failed_updates], [1, 1]);
		write("Notes/folder-html.md", "<img src='./x.png'>\n");
		const refused = moveNoteToFolderOnDisk({ vault_path: vault, old_path: file("Notes/folder-html.md"), folder_path: "Topics" });
		assert.equal(refused.statusCode, 409);
		assert.ok(!refused.payload.error.startsWith(RENAME_REFUSED_PREFIX), "folder moves keep their own contract");
		assert.equal(read("Notes/folder-html.md"), "<img src='./x.png'>\n");
	}));

// E2 commentary discovery asks native for 2000 and trusts "fewer than asked" as complete.
test("dev vault search keeps the requested bound and the captured vault, 20 by default", () =>
	withDiskVault(async ({ vault, write }) => {
		const other = realpathSync(await mkdtemp(path.join(os.tmpdir(), "leadinglight-search-other-")));
		try {
			for (let index = 0; index < 25; index += 1) write(`Notes/c-${index}.md`, `# Commentary ${index}\n\nsynthetic-marker\n`);
			for (let index = 0; index < 3; index += 1) writeFileSync(path.join(other, `b-${index}.md`), "# B\n\nsynthetic-marker\n");
			const search = (args) => runVaultCommand({ cmd: "search_vault", args: { query: "synthetic-marker", ...args } });
			const inVault = (root) => (result) => result.path.startsWith(`${root}${path.sep}`);
			const asked = search({ vault_path: vault, limit: 2000 });
			assert.equal(asked.statusCode, 200);
			assert.equal(asked.payload.results.length, 25);
			assert.ok(asked.payload.results.every(inVault(vault)));
			assert.equal(search({ vault_path: vault, limit: "2000" }).payload.results.length, 25);
			assert.equal(search({ vault_path: vault }).payload.results.length, 20);
			assert.equal(search({ vault_path: vault, limit: 21 }).payload.results.length, 21);
			// A then B then A: each request is answered by the vault it names.
			const fromOther = search({ vault_path: other, limit: 2000 });
			assert.equal(fromOther.payload.results.length, 3);
			assert.ok(fromOther.payload.results.every(inVault(other)));
			assert.equal(search({ vault_path: vault, limit: 2000 }).payload.results.length, 25);
			for (const limit of [0, -1, 2.5, 10_001, "many"]) {
				assert.deepEqual(search({ vault_path: vault, limit }), { payload: { error: "Invalid search limit" }, statusCode: 400 });
			}
		} finally {
			await rm(other, { recursive: true, force: true });
		}
	}));
