// Dev-server stand-in for the native E1 extension commands, on synthetic fixture vaults only.
// The shared model (src/mock-tauri/mock-extensions.ts) decides every answer; this file is its disk
// host and its HTTP route. Package files and preferences live in a dev-only registry folder, never
// the app's configuration folder; pages are created only in vaults the browser listed through this
// server. Node gives no handle-relative opens or native durability proof: docs/leadinglight/extensions-browser.md.
import { createHash, randomUUID } from "node:crypto";
import {
	type BigIntStats,
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	opendirSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { EXTENSION_LIMITS } from "../src/leadinglight/extensions/extensionContract.ts";
import {
	type BlobScan,
	type BoundFolder,
	ExtensionArgumentError,
	ExtensionBackend,
	type ExtensionHost,
	type FolderLookup,
	folderSegments,
	isExtensionCommand,
	type PageWrite,
	type PreferencesRead,
	type Publication,
	type VaultRoots,
} from "../src/mock-tauri/mock-extensions.ts";
import { heldPathRefusal } from "./vault-api-save-recovery.ts";

/** HTTP bounds of this route: page owners at once, owners kept for settling, request size. */
export const ROUTE_LIMITS = {
	owners: 4,
	retiredOwners: 32,
	listedVaults: 256,
	/** A 1 MiB page JSON-escaped, with room for its other fields. */
	requestBytes: 8 * 1024 * 1024,
} as const;

/** The filesystem steps a test replaces to stand at a publication boundary. */
export interface DiskExtensionIo {
	/** Publishes `staged` at `target` without replacing anything: a hard link. */
	link(staged: string, target: string): void;
	/** Replaces `target` with `staged`; registry files only, never a page. */
	rename(staged: string, target: string): void;
	unlink(target: string): void;
	syncDir(dir: string): boolean;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const PACKAGE_FILE = /^[0-9a-f]{64}\.json$/;
const SHA256 = /^[0-9a-f]{64}$/;
const identityOf = (stats: BigIntStats) => `${stats.dev}:${stats.ino}`;
const UNAVAILABLE: PageWrite = { status: "unavailable" };
const UNCERTAIN: PageWrite = { status: "uncertain" };

function syncFolder(dir: string): boolean {
	let fd: number | null = null;
	try {
		fd = openSync(dir, constants.O_RDONLY);
		fsyncSync(fd);
		return true;
	} catch {
		return false;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

export const nodeIo: DiskExtensionIo = {
	link: (staged, target) => linkSync(staged, target),
	rename: (staged, target) => renameSync(staged, target),
	unlink: (target) => unlinkSync(target),
	syncDir: syncFolder,
};

function lstatOrNull(target: string): BigIntStats | null {
	try {
		return lstatSync(target, { bigint: true });
	} catch (error) {
		if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
		throw error;
	}
}

/** The path's own identity; null when absent or unreadable. */
function identityAt(target: string): string | null {
	try {
		const stats = lstatOrNull(target);
		return stats ? identityOf(stats) : null;
	} catch {
		return null;
	}
}

/** Exact UTF-8 text, a byte order mark kept, so it hashes back to the same bytes. */
function utf8Text(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return null;
	}
}

/** A plain file's bytes read through one no-follow handle, at most `maxBytes`. Throws on I/O errors. */
function readBounded(file: string, maxBytes: number): Buffer | "missing" | "tooLarge" | "notPlain" {
	const stats = lstatOrNull(file);
	if (!stats) return "missing";
	if (!stats.isFile()) return "notPlain";
	if (stats.size > BigInt(maxBytes)) return "tooLarge";
	const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		if (!fstatSync(fd).isFile()) return "notPlain";
		const buffer = Buffer.alloc(maxBytes + 1);
		let read = 0;
		for (;;) {
			const count = readSync(fd, buffer, read, buffer.length - read, read);
			if (count === 0) break;
			read += count;
			if (read > maxBytes) return "tooLarge";
		}
		return buffer.subarray(0, read);
	} finally {
		closeSync(fd);
	}
}

/**
 * Replaces `file` with synced `text`. A failure before the rename leaves the file as it was; once
 * the temporary file is gone the rename happened, whatever the call said, and only the folder
 * sync decides `synced` or `unsynced`.
 */
function publishFile(dir: string, file: string, text: string, io: DiskExtensionIo): Publication {
	const draft = path.join(dir, `.tmp-${randomUUID()}`);
	try {
		const fd = openSync(draft, "wx");
		try {
			writeFileSync(fd, text);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	} catch {
		rmSync(draft, { force: true });
		return "notPublished";
	}
	try {
		io.rename(draft, file);
	} catch {
		let pending = true;
		try {
			pending = lstatOrNull(draft) !== null;
		} catch {
			pending = false;
		}
		if (pending) {
			rmSync(draft, { force: true });
			return "notPublished";
		}
	}
	return io.syncDir(dir) ? "synced" : "unsynced";
}

/** An existing or new real folder, never a link; its parent must already exist. */
function realFolder(target: string): string {
	try {
		mkdirSync(target);
	} catch (error) {
		if (errorCode(error) !== "EEXIST") throw error;
	}
	const stats = lstatSync(target);
	if (!stats.isDirectory()) throw new Error(`${target} is not a folder`);
	return target;
}

// --- Vault folders and pages ------------------------------------------------------------------------

const refusedFolder = (reason: Extract<FolderLookup, { ok: false }>["reason"]): FolderLookup => ({ ok: false, reason });

/**
 * Native `resolve_folder`: an existing real folder inside the vault, reached without following any
 * link, outside every hidden or internal folder (any segment starting with `.`).
 */
export function resolveFolder(root: string, folder: string): FolderLookup {
	const segments = folderSegments(folder);
	if (segments === null) return refusedFolder("outsideVault");
	let current = root;
	for (const segment of segments) {
		current = path.join(current, segment);
		let stats: BigIntStats;
		try {
			stats = lstatSync(current, { bigint: true });
		} catch {
			return refusedFolder("missing");
		}
		if (stats.isSymbolicLink()) return refusedFolder("link");
		if (!stats.isDirectory()) return refusedFolder("notFolder");
	}
	let real: string;
	let stats: BigIntStats;
	try {
		real = realpathSync(current);
		stats = lstatSync(real, { bigint: true });
	} catch {
		return refusedFolder("missing");
	}
	if (real !== current) return refusedFolder("link");
	if (real !== root && !real.startsWith(`${root}${path.sep}`)) return refusedFolder("outsideVault");
	if (!stats.isDirectory()) return refusedFolder("notFolder");
	return { ok: true, folder: { path: real, identity: identityOf(stats), relative: segments.join("/") } };
}

interface Staged {
	dir: string;
	file: string;
}

/** A sibling `.leadinglight-*` folder, ignored by Git before the payload is written, as saves stage. */
function stage(folder: string, name: string, bytes: Buffer): Staged | null {
	const dir = path.join(folder, `.leadinglight-${randomUUID().slice(0, 8)}`);
	try {
		mkdirSync(dir);
		writeFileSync(path.join(dir, ".gitignore"), "*\n");
		const file = path.join(dir, name);
		const fd = openSync(file, "wx");
		try {
			writeFileSync(fd, bytes);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return { dir, file };
	} catch {
		rmSync(dir, { recursive: true, force: true });
		return null;
	}
}

/** Removes an emptied staging folder and its `.gitignore`; anything else left there is kept. */
function removeStagingFolder(dir: string): void {
	rmSync(path.join(dir, ".gitignore"), { force: true });
	try {
		rmdirSync(dir);
	} catch {
		// Not empty or already gone; nothing else in it is ours to delete.
	}
}

/**
 * The published page's bytes, only while it is still the single plain file staged: the opened
 * handle is checked before a read bounded to the expected length plus one, then the handle and the
 * path again. Like native this catches, but cannot exclude, another local process racing the path.
 */
function readBack(target: string, identity: string, length: number): Buffer | null {
	let fd: number;
	try {
		fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch {
		return null;
	}
	const published = (stats: BigIntStats) =>
		stats.isFile() && stats.nlink === 1n && identityOf(stats) === identity && stats.size === BigInt(length);
	try {
		if (!published(fstatSync(fd, { bigint: true }))) return null;
		const buffer = Buffer.alloc(length + 1);
		let read = 0;
		while (read < buffer.length) {
			const count = readSync(fd, buffer, read, buffer.length - read, read);
			if (count === 0) break;
			read += count;
		}
		if (read !== length || !published(fstatSync(fd, { bigint: true }))) return null;
		return identityAt(target) === identity ? buffer.subarray(0, length) : null;
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

/**
 * Native `publish` after its name, size and digest checks, as one synchronous step so no other
 * bridge write interleaves: the folder rechecked, the page held by nothing, no file at the name,
 * staging beside it, the folder rechecked again, no-clobber publication, folder sync, read-back.
 * Every refusal before publication proves nothing was written; after it, only proof is reported.
 */
export function createPage(
	vault: VaultRoots,
	folder: BoundFolder,
	fileName: string,
	content: string,
	io: DiskExtensionIo,
	warn: (message: string) => void,
): PageWrite {
	const recheck = (): PageWrite | null => {
		const now = resolveFolder(vault.canonical, folder.relative);
		if (!now.ok) return now.reason === "missing" || now.reason === "notFolder" ? UNAVAILABLE : { status: "moved" };
		return now.folder.path === folder.path && now.folder.identity === folder.identity ? null : { status: "moved" };
	};
	const before = recheck();
	if (before) return before;
	const target = path.join(folder.path, fileName);
	// The existing page lease: a held page refuses every other mutation, as native's.
	if (heldPathRefusal([target])) return { status: "busy" };
	try {
		if (lstatOrNull(target)) return { status: "exists" };
	} catch {
		return UNAVAILABLE;
	}
	const bytes = Buffer.from(content, "utf8");
	const staged = stage(folder.path, fileName, bytes);
	if (!staged) return UNAVAILABLE;
	const identity = identityAt(staged.file);
	const drop = () => {
		if (identity !== null && identityAt(staged.file) === identity) rmSync(staged.file, { force: true });
		removeStagingFolder(staged.dir);
	};
	if (identity === null) {
		drop();
		return UNAVAILABLE;
	}
	const moved = recheck();
	if (moved) {
		drop();
		return moved;
	}
	const published = (): PageWrite => {
		try {
			io.unlink(staged.file);
		} catch {
			warn(`An extension page was published but is still linked to its staging copy: ${target}`);
			return UNCERTAIN;
		}
		const durable = io.syncDir(folder.path);
		removeStagingFolder(staged.dir);
		return readBack(target, identity, bytes.length)?.equals(bytes) ? { status: "created", durable } : UNCERTAIN;
	};
	try {
		io.link(staged.file, target);
	} catch (error) {
		// A failed call proves nothing was written only while the staged file is ours and the name is free.
		if (identityAt(target) === identity) return published();
		if (errorCode(error) === "EEXIST") {
			drop();
			return { status: "exists" };
		}
		if (identityAt(staged.file) === identity && presence(target) === "absent") {
			drop();
			return UNAVAILABLE;
		}
		warn(`An extension write could not be confirmed; its staged copy is kept: ${staged.file}`);
		return UNCERTAIN;
	}
	return published();
}

function presence(target: string): "absent" | "present" | "unknown" {
	try {
		return lstatOrNull(target) ? "present" : "absent";
	} catch {
		return "unknown";
	}
}

/** Like Rust's `Path::join`: nothing is normalized, so the path matches the app's own entries. */
function joinRaw(base: string, part: string): string {
	return base.endsWith(path.sep) ? `${base}${part}` : `${base}${path.sep}${part}`;
}

// --- The disk host ----------------------------------------------------------------------------------

export interface DiskHostOptions {
	/** The registry folder: package files and preferences, outside every vault. */
	root: string;
	/** A vault this host may serve, resolved now. */
	vaultRoots: (vaultPath: string) => VaultRoots | null;
	bundled: readonly string[];
	io?: DiskExtensionIo;
	warn?: (message: string) => void;
}

export function diskExtensionHost(options: DiskHostOptions): ExtensionHost {
	const io = options.io ?? nodeIo;
	const warn = options.warn ?? ((message: string) => console.warn(`[vault-api] ${message}`));
	const packages = path.join(options.root, "packages");
	const preferences = path.join(options.root, "preferences.json");
	const blobFile = (sha: string) => path.join(packages, `${sha}.json`);
	const registryFolders = () => {
		mkdirSync(options.root, { recursive: true });
		if (!lstatSync(options.root).isDirectory()) throw new Error("The extension registry is not a folder");
		return realFolder(packages);
	};
	const readBlob = (sha: string): string | null => {
		if (!SHA256.test(sha)) return null;
		try {
			const bytes = readBounded(blobFile(sha), EXTENSION_LIMITS.packageBytes);
			return typeof bytes === "string" ? null : utf8Text(bytes);
		} catch {
			return null;
		}
	};
	return {
		bundled: options.bundled,
		sha256: async (text) => sha256(text),
		readBlob: async (sha) => readBlob(sha),
		async writeBlob(sha, text) {
			if (!SHA256.test(sha)) return false;
			let dir: string;
			try {
				dir = registryFolders();
			} catch {
				return false;
			}
			const published = publishFile(dir, blobFile(sha), text, io);
			if (published === "unsynced") warn("An extension package is in place, but its folder could not be synced.");
			return published !== "notPublished";
		},
		async deleteBlob(sha) {
			if (!SHA256.test(sha)) return false;
			try {
				io.unlink(blobFile(sha));
				return true;
			} catch (error) {
				return errorCode(error) === "ENOENT";
			}
		},
		async scanBlobs(limit): Promise<BlobScan | null> {
			let dir: ReturnType<typeof opendirSync>;
			try {
				dir = opendirSync(packages);
			} catch (error) {
				return errorCode(error) === "ENOENT" ? { hashes: [], complete: true } : null;
			}
			try {
				// Named like a package, whatever it is, as native counts them: one that cannot be removed still counts.
				const hashes: string[] = [];
				for (let read = 0; read < limit; read++) {
					const entry = dir.readSync();
					if (entry === null) return { hashes, complete: true };
					if (PACKAGE_FILE.test(entry.name)) hashes.push(entry.name.slice(0, 64));
				}
				return { hashes, complete: dir.readSync() === null };
			} catch {
				return null;
			} finally {
				dir.closeSync();
			}
		},
		async readPreferences(maxBytes): Promise<PreferencesRead> {
			try {
				const bytes = readBounded(preferences, maxBytes);
				if (bytes === "missing") return { status: "missing" };
				const text = typeof bytes === "string" ? null : utf8Text(bytes);
				return text === null ? { status: "unusable" } : { status: "text", text };
			} catch {
				return { status: "unusable" };
			}
		},
		async writePreferences(text) {
			try {
				registryFolders();
			} catch {
				return "notPublished";
			}
			return publishFile(options.root, preferences, text, io);
		},
		async setPreferencesAside() {
			try {
				io.rename(preferences, path.join(options.root, "preferences.unreadable.json"));
			} catch {
				// A file that cannot be moved is replaced by the next published preferences.
			}
		},
		vaultRoots: async (vaultPath) => options.vaultRoots(vaultPath),
		resolveFolder: async (root, folder) => resolveFolder(root, folder),
		createPage: async (vault, folder, fileName, content) => createPage(vault, folder, fileName, content, io, warn),
		pagePath: (vault, folder, fileName) =>
			joinRaw(folder.relative === "" ? vault.requested : joinRaw(vault.requested, folder.relative.split("/").join(path.sep)), fileName),
		warn,
	};
}

// --- Vaults, owners and the route -------------------------------------------------------------------

const hasParentStep = (target: string) => target.split(/[\\/]/).includes("..");

function realRoot(vaultPath: unknown): string | null {
	if (typeof vaultPath !== "string" || !path.isAbsolute(vaultPath) || hasParentStep(vaultPath)) return null;
	try {
		return statSync(vaultPath).isDirectory() ? realpathSync(vaultPath) : null;
	} catch {
		return null;
	}
}

/** Commands an owner that has left may still send: they settle or report, never start work. */
const SETTLING = new Set(["close_extension_session", "end_extension_run", "query_document_proposal"]);

export interface DiskExtensionsOptions {
	root: string;
	bundled?: readonly string[];
	io?: DiskExtensionIo;
	warn?: (message: string) => void;
}

export interface RouteResponse {
	statusCode: number;
	payload: unknown;
}

/**
 * One dev server's extensions. Owners stand in for native windows: this route issues each page a
 * fresh owner and never accepts one it did not issue. A page that leaves, or the oldest when more
 * pages register than the bound, has its sessions closed as native closes a reloaded window's.
 */
export function createDiskExtensions(options: DiskExtensionsOptions) {
	const listed = new Set<string>();
	const vaultRoots = (vaultPath: string): VaultRoots | null => {
		const canonical = realRoot(vaultPath);
		return canonical !== null && listed.has(canonical) ? { requested: vaultPath, canonical } : null;
	};
	const backend = new ExtensionBackend(
		diskExtensionHost({ root: options.root, vaultRoots, bundled: options.bundled ?? [], io: options.io, warn: options.warn }),
	);
	const live: string[] = [];
	const retired: string[] = [];
	const retire = (owner: string) => {
		retired.push(owner);
		while (retired.length > ROUTE_LIMITS.retiredOwners) retired.shift();
		backend.forgetOwner(owner);
	};
	return {
		backend,
		/** The browser listed this vault through the server: the stand-in for native's registered vaults. */
		noteVault(vaultPath: unknown): void {
			const canonical = realRoot(vaultPath);
			if (canonical !== null && listed.size < ROUTE_LIMITS.listedVaults) listed.add(canonical);
		},
		register(): string {
			const owner = `owner-${randomUUID()}`;
			live.push(owner);
			while (live.length > ROUTE_LIMITS.owners) {
				const oldest = live.shift();
				if (oldest !== undefined) retire(oldest);
			}
			return owner;
		},
		end(owner: unknown): boolean {
			const index = typeof owner === "string" ? live.indexOf(owner) : -1;
			if (index < 0) return false;
			live.splice(index, 1);
			retire(owner as string);
			return true;
		},
		async command(name: string, body: unknown): Promise<RouteResponse> {
			if (!isExtensionCommand(name)) return { statusCode: 404, payload: { error: "No such extension command" } };
			const fields = typeof body === "object" && body !== null ? body : {};
			const owner = Reflect.get(fields, "owner");
			const standing = typeof owner !== "string" ? null : live.includes(owner) ? "live" : retired.includes(owner) ? "retired" : null;
			if (standing === null || (standing === "retired" && !SETTLING.has(name))) {
				return { statusCode: 403, payload: { error: "This page has no extension owner here; reload it." } };
			}
			try {
				return { statusCode: 200, payload: await backend.handle(name, Reflect.get(fields, "args"), owner as string) };
			} catch (error) {
				if (error instanceof ExtensionArgumentError) return { statusCode: 400, payload: { error: error.message } };
				throw error;
			}
		},
	};
}

export type DiskExtensions = ReturnType<typeof createDiskExtensions>;

const appConfigFolders = () => {
	const home = os.homedir();
	const xdg = process.env.XDG_CONFIG_HOME;
	return [path.join(home, ".config"), path.join(home, "Library", "Application Support"), ...(xdg && path.isAbsolute(xdg) ? [xdg] : [])];
};
const isInside = (folder: string, target: string) => target === folder || target.startsWith(`${folder}${path.sep}`);

/**
 * A disposable dev-only namespace for this checkout, never the app's configuration folder. Set
 * LEADINGLIGHT_DEV_EXTENSIONS_DIR to choose another disposable folder; one inside an app
 * configuration folder is refused.
 */
export function devRegistryRoot(env: NodeJS.ProcessEnv = process.env, checkout = process.cwd()): string {
	const chosen = env.LEADINGLIGHT_DEV_EXTENSIONS_DIR;
	const root = chosen && path.isAbsolute(chosen)
		? path.resolve(chosen)
		: path.join(os.tmpdir(), `leadinglight-dev-extensions-${sha256(checkout).slice(0, 12)}`);
	if (appConfigFolders().some((folder) => isInside(path.resolve(folder), root))) {
		throw new Error("The dev extension registry must not be inside an app configuration folder.");
	}
	return root;
}

/** The native bundled package, read as exact bytes; missing until native source is integrated. */
export function bundledPackages(): string[] {
	try {
		return [readFileSync(new URL("../src-tauri/src/leadinglight_extensions/bundled/meeting-debrief.json", import.meta.url), "utf8")];
	} catch {
		console.warn("[vault-api] The bundled extension package is not available in this checkout.");
		return [];
	}
}

let devExtensions: DiskExtensions | null = null;
const defaultExtensions = (): DiskExtensions => {
	devExtensions ??= createDiskExtensions({ root: devRegistryRoot(), bundled: bundledPackages() });
	return devExtensions;
};

/** Called when the browser lists a vault through this server. Never fails that listing. */
export function noteExtensionVault(vaultPath: unknown): void {
	try {
		defaultExtensions().noteVault(vaultPath);
	} catch (error) {
		console.warn(`[vault-api] ${(error as Error).message}`);
	}
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size <= limit) chunks.push(chunk);
		});
		req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function send(res: ServerResponse, { statusCode, payload }: RouteResponse): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

async function route(name: string, req: IncomingMessage, extensions: DiskExtensions): Promise<RouteResponse> {
	if (req.method !== "POST") return { statusCode: 405, payload: { error: "Unsupported method" } };
	// JSON only, so another site's page cannot send a simple cross-origin request here.
	if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
		return { statusCode: 415, payload: { error: "Extension requests are JSON" } };
	}
	const text = await readBody(req, ROUTE_LIMITS.requestBytes);
	if (text === null) return { statusCode: 413, payload: { error: "The request is too large" } };
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return { statusCode: 400, payload: { error: "The request is not JSON" } };
	}
	if (name === "owner") return { statusCode: 200, payload: { owner: extensions.register() } };
	if (name === "owner-end") {
		return { statusCode: 200, payload: { ended: extensions.end(typeof body === "object" && body !== null ? Reflect.get(body, "owner") : null) } };
	}
	return extensions.command(name, body);
}

/** `/api/extensions/<command>` and the owner routes; false for every other path. */
export async function handleExtensionApiRequest(
	req: IncomingMessage,
	res: ServerResponse,
	extensions?: DiskExtensions,
): Promise<boolean> {
	const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
	if (!pathname.startsWith("/api/extensions/")) return false;
	try {
		send(res, await route(pathname.slice("/api/extensions/".length), req, extensions ?? defaultExtensions()));
	} catch (error) {
		send(res, { statusCode: 500, payload: { error: error instanceof Error ? error.message : "Extension command failed" } });
	}
	return true;
}
