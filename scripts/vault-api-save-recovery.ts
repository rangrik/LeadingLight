// Dev-server stand-in for the native S0 save commands, on synthetic fixture vaults only.
// Real files, native outcome shapes; Node limits versus native are listed in m5-bridge-report.md.
import { createHash, randomUUID } from "node:crypto";
import {
	accessSync,
	type BigIntStats,
	closeSync,
	constants,
	existsSync,
	fchmodSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
	ConfirmedSnapshot,
	CopyOutcome,
	ResolutionRefusalReason,
} from "../src/leadinglight/saveOutcome.ts";
import {
	type CopyJob,
	createSaveRecovery,
	type PageWrite,
	runSaveRecoveryCommand,
	SaveRecoveryArgumentError,
	type SaveRecoveryCommand,
	type SaveRecoveryStore,
} from "../src/mock-tauri/mock-save-recovery.ts";

interface Identity {
	dev: string;
	ino: string;
	size: string;
	mtimeNs: string;
}
interface Original {
	identity: Identity;
	bytes: Buffer;
}
interface Staged {
	dir: string;
	file: string;
}
interface UncertainProof {
	original: Original;
	staged: Staged;
	stagedIdentity: Identity;
}
/** Native's copy intent: the staged file's identity is recorded before any name is taken. */
interface Intent {
	args: string;
	binding: string;
	/** The copied draft; keep-copy must confirm exactly this sequence and these bytes. */
	seq: number;
	contentSha256: string;
	destination: string;
	name: string;
	staged: string;
	identity: { dev: string; ino: string } | null;
	candidate: string | null;
	durable: boolean;
}
interface CopyContext {
	job: CopyJob;
	rootReal: string;
	dir: string;
	file: string;
}

/** The answer for a vault that is not on disk; the browser treats it as a failed command. */
export const NOT_DISK_VAULT = "notDiskVault";

const sha256 = (bytes: Buffer) =>
	createHash("sha256").update(bytes).digest("hex");
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const identityOf = (stats: BigIntStats): Identity => ({
	dev: String(stats.dev),
	ino: String(stats.ino),
	size: String(stats.size),
	mtimeNs: String(stats.mtimeNs),
});
const sameIdentity = (a: Identity, b: Identity) =>
	a.dev === b.dev &&
	a.ino === b.ino &&
	a.size === b.size &&
	a.mtimeNs === b.mtimeNs;
const leavesRoot = (relative: string) =>
	relative === ".." ||
	relative.startsWith(`..${path.sep}`) ||
	path.isAbsolute(relative);
const insideReal = (rootReal: string, real: string) =>
	real === rootReal || real.startsWith(`${rootReal}${path.sep}`);
const hasParentStep = (target: string) => target.split(/[\\/]/).includes("..");
/** Like Rust's `Path::join`: an absolute part replaces the base, and nothing is normalized. */
const joinRaw = (base: string, part: string) =>
	path.isAbsolute(part)
		? part
		: base.endsWith(path.sep)
			? `${base}${part}`
			: `${base}${path.sep}${part}`;

function lstatOrNull(target: string): BigIntStats | null {
	try {
		return lstatSync(target, { bigint: true });
	} catch (error) {
		if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR")
			return null;
		throw error;
	}
}

function realRoot(root: string): string | null {
	if (!root || !path.isAbsolute(root)) return null;
	try {
		return statSync(root).isDirectory() ? realpathSync(root) : null;
	} catch {
		return null;
	}
}

/** The deepest existing ancestor of the folder resolved, then the missing tail and the leaf, which is never followed. */
function canonicalPage(page: string): string | null {
	const tail: string[] = [];
	let existing = path.dirname(page);
	while (!existsSync(existing)) {
		tail.unshift(path.basename(existing));
		const up = path.dirname(existing);
		if (up === existing) return null;
		existing = up;
	}
	return path.join(realpathSync(existing), ...tail, path.basename(page));
}

function isFolder(target: string): boolean {
	try {
		return statSync(target).isDirectory();
	} catch {
		return false;
	}
}

function canAccess(target: string, mode: number): boolean {
	try {
		accessSync(target, mode);
		return true;
	} catch {
		return false;
	}
}

function readOriginal(page: string): Original {
	const fd = openSync(page, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stats = fstatSync(fd, { bigint: true });
		if (!stats.isFile() || stats.nlink !== 1n)
			throw new Error("not a plain file");
		return { identity: identityOf(stats), bytes: readFileSync(fd) };
	} finally {
		closeSync(fd);
	}
}

/** The same single-link file with the same identity and exact bytes. */
function unchanged(page: string, original: Original): boolean {
	const now = lstatOrNull(page);
	if (
		!now?.isFile() ||
		now.nlink !== 1n ||
		!sameIdentity(identityOf(now), original.identity)
	)
		return false;
	try {
		return readFileSync(page).equals(original.bytes);
	} catch {
		return false;
	}
}

function syncFolder(folder: string): boolean {
	try {
		const fd = openSync(folder, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return true;
	} catch {
		return false;
	}
}

// A sibling .leadinglight-* folder, ignored by Git before any payload is written.
function stage(
	folder: string,
	name: string,
	bytes: Buffer,
	mode: number | null,
): Staged | null {
	const dir = path.join(folder, `.leadinglight-${randomUUID().slice(0, 8)}`);
	try {
		mkdirSync(dir);
		writeFileSync(path.join(dir, ".gitignore"), "*\n");
		const file = path.join(dir, name);
		const fd = openSync(file, "wx");
		try {
			writeFileSync(fd, bytes);
			if (mode !== null) fchmodSync(fd, mode);
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

const hold = (
	reason: "missing" | "parentMissing" | "linked" | "symlink",
): PageWrite => ({ status: "hold", reason });

function writePage(page: string, content: string): PageWrite {
	const folder = path.dirname(page);
	if (!isFolder(folder)) return hold("parentMissing");
	let leaf: BigIntStats | null;
	try {
		leaf = lstatOrNull(page);
	} catch {
		return { status: "refused", reason: "readFailed" };
	}
	if (!leaf) return hold("missing");
	if (leaf.isSymbolicLink()) return hold("symlink");
	if (!leaf.isFile()) return { status: "refused", reason: "readFailed" };
	if (leaf.nlink > 1n) return hold("linked");
	if (!canAccess(page, constants.W_OK))
		return { status: "refused", reason: "readOnly" };
	let original: Original;
	try {
		original = readOriginal(page);
	} catch {
		return { status: "refused", reason: "readFailed" };
	}
	const next = Buffer.from(content, "utf8");
	if (next.equals(original.bytes))
		return { status: "committed", written: false, durable: true };
	const staged = stage(
		folder,
		path.basename(page),
		next,
		Number(leaf.mode & 0o7777n),
	);
	if (!staged) return { status: "refused", reason: "stageFailed" };
	if (!unchanged(page, original)) {
		rmSync(staged.dir, { recursive: true, force: true });
		return { status: "conflict" };
	}
	const stagedIdentity = identityOf(lstatSync(staged.file, { bigint: true }));
	try {
		renameSync(staged.file, page);
	} catch {
		if (!unchanged(page, original)) {
			const proof: UncertainProof = { original, staged, stagedIdentity };
			return {
				status: "uncertain",
				originalAt: null,
				stagedAt: staged.file,
				proof,
			};
		}
		rmSync(staged.dir, { recursive: true, force: true });
		return { status: "failed" };
	}
	const durable = syncFolder(folder);
	rmSync(staged.dir, { recursive: true, force: true });
	return { status: "committed", written: true, durable };
}

/** Removes an emptied `.leadinglight-*` staging folder and its `.gitignore`, never anything else. */
function removeStagingFolder(folder: string): void {
	if (
		!path.basename(folder).startsWith(".leadinglight-") ||
		!lstatOrNull(folder)?.isDirectory()
	)
		return;
	rmSync(path.join(folder, ".gitignore"), { force: true });
	try {
		rmdirSync(folder);
	} catch {
		// Anything else left there is not ours to delete.
	}
}

// The registry calls this only while the page still resolves where it was saved.
function reprove(
	page: string,
	submittedSha256: string,
	proof: UncertainProof | null,
): "committed" | "failed" | "uncertain" {
	try {
		const now = lstatOrNull(page);
		if (
			now?.isFile() &&
			now.nlink === 1n &&
			sha256(readFileSync(page)) === submittedSha256
		)
			return "committed";
		if (!proof || !unchanged(page, proof.original)) return "uncertain";
		// Staging is removed only while it is still the file this save made.
		const staged = lstatOrNull(proof.staged.file);
		if (staged && sameIdentity(identityOf(staged), proof.stagedIdentity)) {
			unlinkSync(proof.staged.file);
			removeStagingFolder(proof.staged.dir);
		}
		return "failed";
	} catch {
		return "uncertain";
	}
}

/** Replaces `file` in one step with synced `text`, its folder entry synced too, as native's `write_file`. */
function writeSynced(dir: string, file: string, text: string): void {
	const draft = path.join(dir, `.tmp-${randomUUID().slice(0, 8)}`);
	try {
		const fd = openSync(draft, "wx");
		try {
			writeFileSync(fd, text);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(draft, file);
	} catch (error) {
		rmSync(draft, { force: true });
		throw error;
	}
	if (!syncFolder(dir)) throw new Error(`${dir} could not be synced`);
}

/** A real folder only, created when missing: a linked store could write outside the vault. Its entry is synced. */
function realFolder(target: string): string {
	try {
		mkdirSync(target);
	} catch (error) {
		if (errorCode(error) !== "EEXIST") throw error;
	}
	if (!lstatSync(target).isDirectory())
		throw new Error(`${target} is not a folder`);
	if (!syncFolder(path.dirname(target)))
		throw new Error(`${path.dirname(target)} could not be synced`);
	return target;
}

/** Native's `.leadinglight/history`, excluded from Git before any intent is written. */
function historyDir(rootReal: string): string {
	const dir = realFolder(
		path.join(realFolder(path.join(rootReal, ".leadinglight")), "history"),
	);
	const ignore = path.join(dir, ".gitignore");
	const excluded =
		lstatOrNull(ignore)?.isFile() && readFileSync(ignore, "utf8") === "*\n";
	if (!excluded) writeSynced(dir, ignore, "*\n");
	return dir;
}

function readIntent(file: string): Intent | null {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as Intent;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw error;
	}
}

/** Still a real folder under the recorded destination inside the vault, so nothing read or removed in it follows a swapped link. */
function realFolderInside(
	folder: string,
	intent: Intent,
	rootReal: string,
): boolean {
	if (
		!insideReal(intent.destination, folder) ||
		!insideReal(rootReal, intent.destination)
	)
		return false;
	try {
		return realpathSync(folder) === folder;
	} catch {
		return false;
	}
}

/** Same file as the one staged, by device and inode; extra links are allowed here. */
function sameFile(intent: Intent, target: string): boolean {
	const stats = intent.identity ? lstatOrNull(target) : null;
	return Boolean(
		stats?.isFile() &&
			String(stats.dev) === intent.identity?.dev &&
			String(stats.ino) === intent.identity?.ino,
	);
}

/** The copy this operation made, as one plain single-link file. */
const owns = (intent: Intent, target: string) =>
	sameFile(intent, target) && lstatOrNull(target)?.nlink === 1n;

/** Reads through one handle and checks it is still the owned file. */
function readOwned(intent: Intent, target: string): Buffer | null {
	try {
		const fd = openSync(
			target,
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
		);
		try {
			const bytes = readFileSync(fd);
			const handle = fstatSync(fd, { bigint: true });
			const same =
				String(handle.dev) === intent.identity?.dev &&
				String(handle.ino) === intent.identity?.ino;
			return same && owns(intent, target) ? bytes : null;
		} finally {
			closeSync(fd);
		}
	} catch {
		return null;
	}
}

/** Removes a staged file only while it is still ours, then its empty staging folder. */
function dropStaging(intent: Intent): void {
	if (sameFile(intent, intent.staged)) unlinkSync(intent.staged);
	removeStagingFolder(path.dirname(intent.staged));
}

/** `<stem>-2.<ext>` onwards; never the original name, so a missing page is never recreated. */
function candidates(dir: string, name: string): string[] {
	const extension = path.extname(name);
	const stem = name.slice(0, name.length - extension.length);
	return Array.from({ length: 100 }, (_, index) =>
		path.join(dir, `${stem}-${index + 2}${extension}`),
	);
}

const failed = (error: unknown): CopyOutcome => ({
	status: "failed",
	message: error instanceof Error ? error.message : String(error),
});

/** A real folder inside the vault and outside its hidden `.leadinglight*` stores. */
function destinationOf(
	requested: string,
	rootReal: string,
): string | CopyOutcome {
	const outside: CopyOutcome = { status: "refused", reason: "outsideVault" };
	const unavailable: CopyOutcome = {
		status: "folderUnavailable",
		recordedFolder: requested,
	};
	if (hasParentStep(requested)) return outside;
	let canonical: string;
	try {
		if (!lstatSync(requested).isDirectory()) return unavailable;
		canonical = realpathSync(requested);
	} catch {
		return unavailable;
	}
	if (!insideReal(rootReal, canonical)) return outside;
	const inside = path.relative(rootReal, canonical);
	return inside.split(path.sep).some((part) => part.startsWith(".leadinglight"))
		? outside
		: canonical;
}

function created(
	context: CopyContext,
	candidate: string,
	durable: boolean,
): CopyOutcome {
	const relative = path.relative(context.rootReal, candidate);
	return {
		status: "created",
		path: joinRaw(context.job.root, relative),
		relativePath: relative.split(path.sep).join("/"),
		durable,
	};
}

function create(context: CopyContext, intent: Intent): CopyOutcome {
	const { job } = context;
	const dir = destinationOf(
		job.folder === null
			? path.dirname(job.page)
			: joinRaw(job.root, job.folder),
		context.rootReal,
	);
	if (typeof dir !== "string") return dir;
	const staged = stage(dir, "draft", Buffer.from(job.content, "utf8"), null);
	if (!staged) return failed("The copy could not be prepared.");
	const stats = lstatSync(staged.file, { bigint: true });
	const record: Intent = {
		...intent,
		destination: dir,
		staged: staged.file,
		identity: { dev: String(stats.dev), ino: String(stats.ino) },
	};
	// Not durable means not published; the staging goes and a retry starts clean.
	try {
		writeSynced(context.dir, context.file, JSON.stringify(record));
	} catch (error) {
		rmSync(staged.dir, { recursive: true, force: true });
		rmSync(context.file, { force: true });
		return failed(error);
	}
	// A hard link never replaces an existing file, so each name is tried without clobbering.
	for (const candidate of candidates(dir, record.name)) {
		try {
			linkSync(staged.file, candidate);
		} catch (error) {
			if (errorCode(error) === "EEXIST") continue;
			rmSync(staged.dir, { recursive: true, force: true });
			rmSync(context.file, { force: true });
			return failed(error);
		}
		const durable = syncFolder(dir);
		rmSync(staged.dir, { recursive: true, force: true });
		try {
			writeSynced(
				context.dir,
				context.file,
				JSON.stringify({ ...record, candidate, durable }),
			);
		} catch {
			// A retry still finds the copy by its file identity.
		}
		return created(context, candidate, durable);
	}
	rmSync(staged.dir, { recursive: true, force: true });
	rmSync(context.file, { force: true });
	return { status: "refused", reason: "nameUnavailable" };
}

/** Finishes or reports an earlier attempt with the same operation and arguments. */
function resume(context: CopyContext, intent: Intent): CopyOutcome {
	const safe = (folder: string) =>
		realFolderInside(folder, intent, context.rootReal);
	if (intent.candidate) {
		return safe(path.dirname(intent.candidate)) &&
			owns(intent, intent.candidate)
			? created(context, intent.candidate, intent.durable)
			: { status: "uncertain", candidatePath: intent.candidate };
	}
	if (!safe(intent.destination))
		return { status: "uncertain", candidatePath: null };
	const stagedHere = safe(path.dirname(intent.staged));
	// The break came after staging; the copy may already carry the staged file's identity.
	const published = candidates(intent.destination, intent.name).find(
		(candidate) => sameFile(intent, candidate),
	);
	if (published) {
		if (stagedHere) dropStaging(intent);
		try {
			writeSynced(
				context.dir,
				context.file,
				JSON.stringify({ ...intent, candidate: published }),
			);
		} catch {
			// The next retry finds it the same way.
		}
		return created(context, published, false);
	}
	if (!stagedHere || !sameFile(intent, intent.staged))
		return { status: "uncertain", candidatePath: null };
	// Never published: clear the old attempt and start again from this draft.
	dropStaging(intent);
	rmSync(context.file, { force: true });
	return create(context, intent);
}

function copyDraft(job: CopyJob): CopyOutcome {
	const rootReal = realRoot(job.root);
	if (!rootReal) return { status: "refused", reason: "outsideVault" };
	let dir: string;
	try {
		dir = historyDir(rootReal);
	} catch (error) {
		return failed(`Page history is unavailable: ${(error as Error).message}`);
	}
	const context: CopyContext = {
		job,
		rootReal,
		dir,
		file: path.join(dir, `copy-${job.operationId}.json`),
	};
	let recorded: Intent | null;
	try {
		recorded = readIntent(context.file);
	} catch {
		return { status: "uncertain", candidatePath: null };
	}
	if (recorded && recorded.args !== job.args)
		return { status: "refused", reason: "operationMismatch" };
	if (recorded) return resume(context, recorded);
	const name = path.basename(job.page) || "Untitled.md";
	const fresh: Intent = {
		args: job.args,
		binding: job.binding,
		seq: job.seq,
		contentSha256: job.contentSha256,
		destination: "",
		name,
		staged: "",
		identity: null,
		candidate: null,
		durable: false,
	};
	return create(context, fresh);
}

/** Keep-copy proof: this request's published copy, still the same single file in a safe folder, still the confirmed draft. */
function verifyCopy(
	root: string,
	operationId: string,
	binding: string,
	confirmed: ConfirmedSnapshot,
): ResolutionRefusalReason | null {
	const rootReal = realRoot(root);
	let dir: string;
	try {
		// Native answers busy when it cannot take the copy lock.
		if (!rootReal) return "busy";
		dir = historyDir(rootReal);
	} catch {
		return "busy";
	}
	let intent: Intent | null;
	try {
		intent = readIntent(path.join(dir, `copy-${operationId}.json`));
	} catch {
		return "copyNotPublished";
	}
	if (!intent) return "copyNotPublished";
	if (intent.binding !== binding) return "operationMismatch";
	if (!intent.candidate) return "copyNotPublished";
	if (
		!realFolderInside(path.dirname(intent.candidate), intent, rootReal) ||
		!owns(intent, intent.candidate)
	)
		return "copyNotOwned";
	const bytes = readOwned(intent, intent.candidate);
	const sameDraft =
		intent.seq === confirmed.seq &&
		intent.contentSha256 === confirmed.contentSha256;
	return sameDraft &&
		bytes !== null &&
		sha256(bytes) === confirmed.contentSha256
		? null
		: "copyChanged";
}

const diskStore: SaveRecoveryStore = {
	pageKey(request) {
		const rootReal = realRoot(request.vaultPath);
		const page = request.path;
		if (!rootReal || !path.isAbsolute(page) || hasParentStep(page)) return null;
		const relative = path.relative(request.vaultPath, page);
		if (!relative || leavesRoot(relative)) return null;
		try {
			const key = canonicalPage(page);
			return key && insideReal(rootReal, path.dirname(key)) ? key : null;
		} catch {
			return null;
		}
	},
	writePage: (request, content) => writePage(request.path, content),
	reprove: (request, proof) =>
		reprove(
			request.path,
			request.submittedSha256,
			proof as UncertainProof | null,
		),
	rootIsUsable: (root) => realRoot(root) !== null,
	copyDraft,
	verifyCopy,
};

/** One registry for this dev-server process, like native's for the app's process. */
export const diskSaveRecovery = createSaveRecovery(diskStore);

/** Native refuses other mutations of a held page, or of a folder holding one; this is that refusal. */
export function heldPathRefusal(paths: readonly unknown[]): string | null {
	const held = diskSaveRecovery.heldKeys();
	if (held.length === 0) return null;
	for (const target of paths) {
		if (typeof target !== "string" || !path.isAbsolute(target)) continue;
		let key: string | null = null;
		try {
			key = canonicalPage(target);
		} catch {
			// An unresolvable path cannot name a held page.
		}
		if (
			key &&
			held.some((page) => page === key || page.startsWith(`${key}${path.sep}`))
		)
			return `held: ${target}`;
	}
	return null;
}

// A vault once answered from disk stays a disk vault, even if its folder vanishes later.
const diskVaults = new Set<string>();

// Native Check and Discard need no vault: they bind, void or answer from the registry alone.
const ROOTLESS = new Set<SaveRecoveryCommand>([
	"check_save_outcome",
	"discard_hold",
]);

export async function runDiskSaveRecovery(
	command: SaveRecoveryCommand,
	body: unknown,
): Promise<{ payload: unknown; statusCode: number }> {
	const vaultPath = (body as { request?: { vaultPath?: unknown } } | null)
		?.request?.vaultPath;
	if (typeof vaultPath === "string") {
		if (realRoot(vaultPath)) diskVaults.add(vaultPath);
		else if (!diskVaults.has(vaultPath) && !ROOTLESS.has(command))
			return { payload: { error: NOT_DISK_VAULT }, statusCode: 404 };
	}
	try {
		return {
			payload: await runSaveRecoveryCommand(diskSaveRecovery, command, body),
			statusCode: 200,
		};
	} catch (error) {
		if (error instanceof SaveRecoveryArgumentError)
			return { payload: { error: error.message }, statusCode: 400 };
		throw error;
	}
}
