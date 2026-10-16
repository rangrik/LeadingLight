// Native's backup contract on real disk files for the dev server; jobs yield per chunk so status and cancel interleave.
// Limit: no descriptor-anchored walk, so a same-user swap between a check and an open can redirect one read or write.
import { createHash, randomBytes } from "node:crypto";
import {
	type BigIntStats,
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	futimesSync,
	linkSync,
	lstatSync,
	mkdirSync,
	opendirSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	rmdirSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
	BACKUP_COMMANDS,
	BACKUP_LIMITS,
	type BackupCommand,
	type BackupFailure,
	type BackupManifest,
	type BackupResult,
	type CancelAnswer,
	type GapReason,
	type InspectResult,
	MANIFEST_FORMAT,
	MANIFEST_NAME,
	MANIFEST_VERSION,
	type OperationKind,
	type OperationResult,
	type OperationState,
	type Phase,
	type Problem,
	type Progress,
	RESTORE_MARKER,
	type RestoreFailure,
	type RestoreResult,
	type StartAnswer,
	type StartRefusal,
	WORKSPACE_FOLDER,
} from "../src/leadinglight/backup/backupContract.ts";
import {
	argsOf,
	BackupArgumentError,
	boundedText,
	byteLength,
	checkPath,
	classifyPath,
	displayName,
	isOperationId,
	isoSeconds,
	nameOk,
	oneProblem,
	serializeManifest,
	STORE,
	skipDir,
	Tally,
	validateManifest,
} from "../src/mock-tauri/mock-backup.ts";
import {
	HISTORY_LIMITS,
	LOCATION_KEY,
	locationKey,
	parseVersionMeta,
	safeRelative,
	versionTime,
} from "../src/mock-tauri/mock-history.ts";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
// As native's `fsx::SUPPORTED`: without no-follow opens, every start is refused as unavailable.
const SUPPORTED = constants.O_NOFOLLOW !== undefined;
const READ = constants.O_RDONLY | NO_FOLLOW;
const CREATE =
	constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
const SMALL_FILE = 4096;
const APP_VERSION = (() => {
	try {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
})();

const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const errorCode = (error: unknown) =>
	(error as NodeJS.ErrnoException | null)?.code;
const idOf = (stats: BigIntStats) => `${stats.dev}:${stats.ino}`;
/** Modified time in whole milliseconds; a time before 1970 is recorded as 0. */
const millis = (stats: BigIntStats) =>
	stats.mtimeNs > 0n ? Number(stats.mtimeNs / 1_000_000n) : 0;
const lossy = new TextDecoder("utf-8");
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const segmentsOf = (relative: string) =>
	relative === "" ? [] : relative.split("/");
const depthOf = (relative: string) => segmentsOf(relative).length;
const parentOf = (relative: string) => {
	const parent = path.posix.dirname(relative);
	return parent === "." ? "" : parent;
};
const join = (folder: string, name: string) =>
	folder ? `${folder}/${name}` : name;
/** Rust's byte-wise `String` order, which native uses for the manifest's file list. */
const byBytes = (a: string, b: string) =>
	Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

function lstatOrNull(target: string): BigIntStats | null {
	try {
		return lstatSync(target, { bigint: true });
	} catch (error) {
		if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR")
			return null;
		throw error;
	}
}
const inside = (base: string, target: string) =>
	target === base || target.startsWith(`${base}${path.sep}`);

/** Every folder from the disk root down to `real`, with its identity, to re-check before use. */
interface Link {
	at: string;
	id: string;
}
function chainOf(real: string): Link[] | null {
	const folders: string[] = [];
	for (let at = real; ; at = path.dirname(at)) {
		folders.unshift(at);
		if (path.dirname(at) === at) break;
	}
	const chain: Link[] = [];
	try {
		for (const at of folders) {
			const stats = lstatOrNull(at);
			if (!stats?.isDirectory()) return null;
			chain.push({ at, id: idOf(stats) });
		}
	} catch {
		return null;
	}
	return chain;
}
function sameChain(chain: readonly Link[]): boolean {
	try {
		return chain.every(({ at, id }) => {
			const stats = lstatOrNull(at);
			return stats?.isDirectory() === true && idOf(stats) === id;
		});
	} catch {
		return false;
	}
}

interface Chosen {
	real: string;
	chain: Link[];
}
/** A chosen folder, canonical, with its chain; or why not, as native's `choose`. */
function choose(given: string): Chosen | "missing" | "notFolder" {
	if (!path.isAbsolute(given)) return "missing";
	let real: string;
	try {
		real = realpathSync(given);
	} catch (error) {
		return errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR"
			? "missing"
			: "notFolder";
	}
	const chain = chainOf(real);
	return chain ? { real, chain } : "notFolder";
}

function fsyncFolder(target: string): boolean {
	let fd: number | null = null;
	try {
		fd = openSync(target, constants.O_RDONLY);
		fsyncSync(fd);
		return true;
	} catch {
		return false;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

function readExactly(fd: number, length: number): Buffer | null {
	const buffer = Buffer.alloc(length);
	let done = 0;
	while (done < length) {
		const read = readSync(fd, buffer, done, length - done, done);
		if (read === 0) return null;
		done += read;
	}
	// One byte more means the file grew while it was read.
	return readSync(fd, Buffer.alloc(1), 0, 1, length) === 0 ? buffer : null;
}

/** A small regular file read through one no-follow handle that is still the file lstat saw. */
function readSmall(target: string, most = SMALL_FILE): Buffer | null {
	let fd: number | null = null;
	try {
		const stats = lstatOrNull(target);
		if (!stats?.isFile() || stats.size > BigInt(most)) return null;
		fd = openSync(target, READ);
		const opened = fstatSync(fd, { bigint: true });
		if (idOf(opened) !== idOf(stats) || opened.size !== stats.size) return null;
		return readExactly(fd, Number(stats.size));
	} catch {
		return null;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

// Names as raw bytes, so a name that is not UTF-8 is seen as such; Node's types omit this option.
const RAW_NAMES = { encoding: "buffer" } as unknown as {
	encoding: BufferEncoding;
};
class TooLarge extends Error {}

/** One folder's names in byte order; a folder past the entry limit stops the walk. */
function sortedEntries(
	dir: string,
	most: number = BACKUP_LIMITS.entries,
	spend?: () => void,
) {
	const handle = opendirSync(dir, RAW_NAMES);
	const names: Buffer[] = [];
	try {
		for (;;) {
			let entry;
			try {
				entry = handle.readSync();
			} catch (error) {
				// Native's directory iterator charges failed entries as well as readable ones.
				spend?.();
				throw error;
			}
			if (!entry) break;
			spend?.();
			if (names.length >= most) throw new TooLarge();
			names.push(entry.name as unknown as Buffer);
		}
	} finally {
		handle.closeSync();
	}
	return names.sort(Buffer.compare);
}
/** One entry name, or null when it is not valid UTF-8. */
const nameOf = (raw: Buffer) => {
	try {
		return strict.decode(raw);
	} catch {
		return null;
	}
};

// --- Outcomes inside a job ----------------------------------------------------------------------

class Cancelled extends Error {}
class Fail extends Error {
	readonly reason: BackupFailure | RestoreFailure;
	readonly at: string | null;
	constructor(reason: BackupFailure | RestoreFailure, at: string | null) {
		super(reason);
		this.reason = reason;
		this.at = at;
	}
}
/** Restore: the backup no longer matches what was inspected. */
class Changed extends Error {
	readonly problem: Problem;
	readonly at: string | null;
	constructor(problem: Problem, at: string | null) {
		super(problem);
		this.problem = problem;
		this.at = at;
	}
}
type NotWritable = "destinationNotWritable" | "parentNotWritable";
function writeFailure(
	error: unknown,
	at: string | null,
	notWritable: NotWritable,
): Fail {
	const code = errorCode(error);
	if (code === "ENOSPC" || code === "EDQUOT") return new Fail("noSpace", at);
	if (code === "EACCES" || code === "EPERM" || code === "EROFS")
		return new Fail(notWritable, at);
	return new Fail("io", at);
}

// --- An output tree we own ----------------------------------------------------------------------

interface Owned {
	id: string;
	sha256: string;
	bytes: number;
}

/** A folder we created exclusively; writes re-check the folders above, and cleanup removes only what is still ours. */
class Output {
	readonly dirs = new Map<string, string>();
	readonly files = new Map<string, Owned>();
	readonly shown: string;
	readonly real: string;
	private readonly parent: readonly Link[];
	private readonly notWritable: NotWritable;
	private constructor(
		shown: string,
		real: string,
		parent: readonly Link[],
		notWritable: NotWritable,
	) {
		this.shown = shown;
		this.real = real;
		this.parent = parent;
		this.notWritable = notWritable;
	}

	/** `null` when the name exists; never reuses an existing folder. */
	static create(
		parentShown: string,
		parent: Chosen,
		name: string,
		notWritable: NotWritable,
	): Output | null {
		const real = path.join(parent.real, name);
		if (!sameChain(parent.chain)) throw new Fail("destinationChanged", null);
		try {
			mkdirSync(real);
		} catch (error) {
			if (errorCode(error) === "EEXIST") return null;
			throw writeFailure(error, null, notWritable);
		}
		const output = new Output(
			path.join(parentShown, name),
			real,
			parent.chain,
			notWritable,
		);
		const stats = lstatOrNull(real);
		if (!stats?.isDirectory()) throw new Fail("destinationChanged", null);
		output.dirs.set("", idOf(stats));
		return output;
	}

	/** The chain from the chosen parent to this folder, unchanged and all ours. */
	private intact(relative: string): boolean {
		if (!sameChain(this.parent)) return false;
		const segments = segmentsOf(relative);
		try {
			for (let depth = 0; depth <= segments.length; depth += 1) {
				const folder = segments.slice(0, depth).join("/");
				const id = this.dirs.get(folder);
				const stats = lstatOrNull(path.join(this.real, folder));
				if (!id || !stats?.isDirectory() || idOf(stats) !== id) return false;
			}
		} catch {
			return false;
		}
		return true;
	}

	/** Creates missing folders one level at a time; an existing name we did not make is a change. */
	folder(relative: string): void {
		const segments = segmentsOf(relative);
		for (let depth = 1; depth <= segments.length; depth += 1) {
			const folder = segments.slice(0, depth).join("/");
			if (this.dirs.has(folder)) continue;
			if (!this.intact(segments.slice(0, depth - 1).join("/")))
				throw new Fail("destinationChanged", null);
			try {
				mkdirSync(path.join(this.real, folder));
			} catch (error) {
				// Taken already: on this disk the name folds into one we made under another spelling.
				if (errorCode(error) === "EEXIST") throw new Fail("io", folder);
				throw writeFailure(error, folder, this.notWritable);
			}
			const stats = lstatOrNull(path.join(this.real, folder));
			if (!stats?.isDirectory()) throw new Fail("destinationChanged", null);
			this.dirs.set(folder, idOf(stats));
		}
		if (!this.intact(relative)) throw new Fail("destinationChanged", null);
	}

	/** A new file, never replacing anything; recorded before any byte is written. */
	create(relative: string): number {
		this.folder(parentOf(relative));
		let fd: number;
		try {
			fd = openSync(path.join(this.real, relative), CREATE, 0o644);
		} catch (error) {
			if (errorCode(error) === "EEXIST") throw new Fail("io", relative);
			throw writeFailure(error, relative, this.notWritable);
		}
		this.files.set(relative, {
			id: idOf(fstatSync(fd, { bigint: true })),
			sha256: "",
			bytes: 0,
		});
		return fd;
	}

	write(fd: number, bytes: Uint8Array, relative: string): void {
		try {
			let done = 0;
			while (done < bytes.length)
				done += writeSync(fd, bytes, done, bytes.length - done);
		} catch (error) {
			throw writeFailure(error, relative, this.notWritable);
		}
	}

	/** Synced and closed; the ledger then holds its hash. */
	finish(fd: number, relative: string, hash: string, bytes: number): void {
		try {
			fsyncSync(fd);
		} catch (error) {
			throw writeFailure(error, relative, this.notWritable);
		} finally {
			closeSync(fd);
		}
		const owned = this.files.get(relative);
		if (owned) Object.assign(owned, { sha256: hash, bytes });
	}

	/** A whole small file: created, written, synced. */
	put(relative: string, bytes: Uint8Array): void {
		const fd = this.create(relative);
		try {
			this.write(fd, bytes, relative);
		} catch (error) {
			closeSync(fd);
			throw error;
		}
		this.finish(fd, relative, sha256(bytes), bytes.length);
	}

	/** Removes one owned file; anything else at that name, or below a changed folder, stays. */
	drop(relative: string): boolean {
		const owned = this.files.get(relative);
		const target = path.join(this.real, relative);
		if (!this.intact(parentOf(relative))) return false;
		try {
			const stats = lstatOrNull(target);
			if (!stats) {
				this.files.delete(relative);
				return true;
			}
			if (!owned || !stats.isFile() || idOf(stats) !== owned.id) return false;
			unlinkSync(target);
			this.files.delete(relative);
			return true;
		} catch {
			return false;
		}
	}

	/** Re-reads one owned file through a no-follow handle; true when it still holds the ledger's bytes. */
	async reread(
		relative: string,
		chunk: number,
		step: () => Promise<void>,
	): Promise<boolean> {
		const owned = this.files.get(relative);
		if (!owned || !this.intact(parentOf(relative))) return false;
		let fd: number | null = null;
		try {
			fd = openSync(path.join(this.real, relative), READ);
			if (idOf(fstatSync(fd, { bigint: true })) !== owned.id) return false;
			const hash = createHash("sha256");
			const buffer = Buffer.alloc(chunk);
			let total = 0;
			while (total <= owned.bytes) {
				const read = readSync(
					fd,
					buffer,
					0,
					Math.min(chunk, owned.bytes + 1 - total),
					total,
				);
				if (read === 0) break;
				hash.update(buffer.subarray(0, read));
				total += read;
				await step();
			}
			return total === owned.bytes && hash.digest("hex") === owned.sha256;
		} catch (error) {
			if (error instanceof Cancelled) throw error;
			return false;
		} finally {
			if (fd !== null) closeSync(fd);
		}
	}

	/** Syncs every folder we made, deepest first; false when any sync failed. */
	syncFolders(): boolean {
		let durable = true;
		const folders = [...this.dirs.keys()].sort(
			(a, b) => depthOf(b) - depthOf(a),
		);
		for (const folder of folders)
			durable = fsyncFolder(path.join(this.real, folder)) && durable;
		return durable;
	}

	stillOurs(): boolean {
		return this.intact("");
	}

	/** Never recursive; the restore marker goes only when nothing else remains. Null when all is gone. */
	cleanup(
		marker: { name: string; bytes: Uint8Array } | null = null,
	): string | null {
		if (!this.stillOurs()) return this.shown;
		const keepLast = marker?.name ?? null;
		let clean = true;
		const files = [...this.files.keys()]
			.filter((relative) => relative !== keepLast)
			.sort((a, b) => depthOf(b) - depthOf(a));
		for (const relative of files) clean = this.drop(relative) && clean;
		const folders = [...this.dirs.keys()]
			.filter((folder) => folder !== "")
			.sort((a, b) => depthOf(b) - depthOf(a));
		for (const folder of folders) clean = this.removeFolder(folder) && clean;
		// Anything else still in the folder, even a stranger's file, keeps it marked unfinished.
		if (!clean || !this.onlyLeft(keepLast)) return this.shown;
		if (keepLast !== null && !this.drop(keepLast)) return this.shown;
		if (this.removeFolder("")) return null;
		// The folder may have gained an entry after the empty check, or removal may fail.
		// Restore its original marker only in our unchanged folder, never over another file.
		if (marker && this.stillOurs()) {
			try {
				this.put(marker.name, marker.bytes);
			} catch {
				// Permissions or a new occupant can prevent repair. Report the leftover either way.
			}
		}
		return this.shown;
	}

	/** The top folder holds nothing but `name`, if given; as native's `only_marker_left`. */
	private onlyLeft(name: string | null): boolean {
		if (!this.intact("")) return false;
		try {
			return sortedEntries(this.real, 2).every((raw) => nameOf(raw) === name);
		} catch {
			return false;
		}
	}

	private removeFolder(folder: string): boolean {
		const target = path.join(this.real, folder);
		if (folder !== "" && !this.intact(parentOf(folder))) return false;
		if (folder === "" && !sameChain(this.parent)) return false;
		try {
			const stats = lstatOrNull(target);
			if (!stats) {
				this.dirs.delete(folder);
				return true;
			}
			if (!stats.isDirectory() || idOf(stats) !== this.dirs.get(folder))
				return false;
			rmdirSync(target);
			this.dirs.delete(folder);
			return true;
		} catch {
			return false;
		}
	}
}

// --- The source -------------------------------------------------------------------------------

interface Sink {
	/** Called once the source file is open and is the file lstat saw. */
	open: () => void;
	write: (bytes: Buffer) => void;
	/** Called when an attempt is given up after `open`; it removes what `open` made. */
	abandon: () => void;
}
interface Copied {
	sha256: string;
	bytes: number;
	modifiedMs: number;
}

/** A source root and the identity of every folder seen below it; reads go only through these. */
class Source {
	readonly root: string;
	private readonly chain: readonly Link[];
	readonly dirs = new Map<string, string>();
	constructor(root: string, chain: readonly Link[]) {
		this.root = root;
		this.chain = chain;
	}

	/** Every folder from the root down to `folder`: real and unchanged, or first seen now with `learn`. */
	intact(folder: string, learn = false): true | "changed" | "link" | "missing" {
		if (!sameChain(this.chain)) return "changed";
		const segments = segmentsOf(folder);
		try {
			for (let depth = 0; depth <= segments.length; depth += 1) {
				const relative = segments.slice(0, depth).join("/");
				const stats = lstatOrNull(path.join(this.root, relative));
				if (!stats) return "missing";
				if (stats.isSymbolicLink()) return "link";
				if (!stats.isDirectory()) return "missing";
				const known = this.dirs.get(relative);
				if (known === undefined && learn) this.dirs.set(relative, idOf(stats));
				else if (known !== idOf(stats)) return "changed";
			}
		} catch {
			return "changed";
		}
		return true;
	}

	/** Up to three attempts at a no-follow read that ends with size, time and identity unchanged; else a gap reason. */
	async read(
		relative: string,
		chunk: number,
		sink: Sink,
		step: () => Promise<void>,
		learn = false,
	): Promise<Copied | GapReason> {
		for (
			let attempt = 0;
			attempt < BACKUP_LIMITS.changingFileAttempts;
			attempt += 1
		) {
			// As native's `read_once`: a folder above that is not as first seen is a changing file.
			if (this.intact(parentOf(relative), learn) !== true) return "changing";
			const target = path.join(this.root, relative);
			let before: BigIntStats | null;
			try {
				before = lstatOrNull(target);
			} catch {
				return "unreadable";
			}
			if (!before) return "missing";
			if (before.isSymbolicLink()) return "link";
			if (!before.isFile()) return "special";
			let fd: number;
			try {
				fd = openSync(target, READ);
			} catch (error) {
				const code = errorCode(error);
				if (code === "ELOOP") return "link";
				if (code === "ENOENT") return "missing";
				return "unreadable";
			}
			let opened = false;
			let unreadable = false;
			try {
				const handle = fstatSync(fd, { bigint: true });
				if (idOf(handle) !== idOf(before) || handle.size !== before.size)
					continue;
				sink.open();
				opened = true;
				const hash = createHash("sha256");
				const buffer = Buffer.alloc(chunk);
				// One byte past the size seen is enough to know it grew; a file written forever still ends.
				const most = Number(before.size) + 1;
				let total = 0;
				for (;;) {
					const want = Math.min(chunk, most - total);
					if (want <= 0) break;
					let read: number;
					try {
						read = readSync(fd, buffer, 0, want, total);
					} catch {
						unreadable = true;
						break;
					}
					if (read === 0) break;
					sink.write(buffer.subarray(0, read));
					hash.update(buffer.subarray(0, read));
					total += read;
					await step();
				}
				const after = fstatSync(fd, { bigint: true });
				const again = lstatOrNull(target);
				const steady =
					!unreadable &&
					BigInt(total) === before.size &&
					after.size === before.size &&
					after.mtimeNs === before.mtimeNs &&
					again !== null &&
					idOf(again) === idOf(before) &&
					idOf(again) === idOf(after) &&
					this.intact(parentOf(relative)) === true;
				if (steady) {
					opened = false;
					return {
						sha256: hash.digest("hex"),
						bytes: total,
						modifiedMs: millis(before),
					};
				}
			} finally {
				closeSync(fd);
				if (opened) sink.abandon();
			}
			if (unreadable) return "unreadable";
		}
		return "changing";
	}
}

// --- Saved versions: history's own listable rule, read only ------------------------------------

const TRASH_ID = /^[0-9a-f]{32}$/;
const MAX_VERSION_BYTES = HISTORY_LIMITS.maxPageBytes;
const STORE_FOLDERS = [
	".leadinglight",
	".leadinglight/history",
	".leadinglight/history/versions",
] as const;
const VERSIONS = STORE_FOLDERS[2];

interface LocationRecord {
	bytes: Buffer;
	recordedPath: string;
}
/** The location's own record when it names a page whose key is this folder; "unreadable" when it could not be read. */
function locationRecord(
	dir: string,
	loc: string,
): LocationRecord | null | "unreadable" {
	const target = path.join(dir, "location.json");
	let stats: BigIntStats | null;
	try {
		stats = lstatOrNull(target);
	} catch {
		return "unreadable";
	}
	if (!stats?.isFile() || stats.size > BigInt(SMALL_FILE)) return null;
	const bytes = readSmall(target);
	if (!bytes) return "unreadable";
	try {
		const value = JSON.parse(strict.decode(bytes)) as Record<
			string,
			unknown
		> | null;
		const keys =
			value && typeof value === "object" && !Array.isArray(value)
				? Object.keys(value)
				: [];
		const recorded = keys.length === 1 ? value?.recordedPath : undefined;
		return typeof recorded === "string" &&
			safeRelative(recorded) &&
			locationKey(recorded, sha256) === loc
			? { bytes, recordedPath: recorded }
			: null;
	} catch {
		return null;
	}
}

const realDir = (target: string) => {
	try {
		return lstatOrNull(target)?.isDirectory() === true;
	} catch {
		return false;
	}
};

/** History's list rule (native `listed`): only its two files, a matching record, a payload of that length. */
function listedVersion(dir: string, loc: string, name: string) {
	const at = versionTime(name);
	const folder = path.join(dir, name);
	try {
		if (at === null || !realDir(folder)) return null;
		const names = sortedEntries(folder, 2).map((raw) => nameOf(raw));
		if (!names.every((n) => n === "payload" || n === "version.json"))
			return null;
		const metaBytes = readSmall(path.join(folder, "version.json"));
		const meta = metaBytes ? parseVersionMeta(strict.decode(metaBytes)) : null;
		const payload = lstatOrNull(path.join(folder, "payload"));
		return meta &&
			meta.capturedAt === at &&
			meta.sha256.slice(0, 16) === name.split("-")[1] &&
			locationKey(meta.recordedPath, sha256) === loc &&
			payload?.isFile() &&
			payload.size === BigInt(meta.length)
			? meta
			: null;
	} catch {
		return null;
	}
}

interface Candidate {
	loc: string;
	name: string;
	length: number;
	sha256: string;
}
interface HistoryPlan {
	candidates: Candidate[];
	unlisted: number;
	unreadable: string[];
}

// As native's `export_candidates`: listable versions within the walk's remaining entry budget.
// A store folder that cannot be read is named, never taken as "no versions".
async function exportCandidates(
	source: Source,
	budget: { left: number },
	step: (rel: string) => Promise<void>,
): Promise<HistoryPlan> {
	const plan: HistoryPlan = { candidates: [], unlisted: 0, unreadable: [] };
	for (const rel of STORE_FOLDERS) {
		let stats: BigIntStats | null;
		try {
			stats = lstatOrNull(path.join(source.root, rel));
		} catch {
			plan.unreadable.push(rel);
			return plan;
		}
		if (!stats) return plan;
		if (!stats.isDirectory()) {
			plan.unreadable.push(rel);
			return plan;
		}
		source.dirs.set(rel, idOf(stats));
	}
	// Each name read spends the shared budget, as native's `spend`; past it the whole backup is too large.
	const spend = (dir: string) => {
		let names: Buffer[];
		try {
			names = sortedEntries(dir, budget.left, () => {
				if (budget.left === 0) throw new TooLarge();
				budget.left -= 1;
			});
		} catch (error) {
			if (error instanceof TooLarge) throw error;
			return null;
		}
		return names;
	};
	const locations = spend(path.join(source.root, VERSIONS));
	if (!locations) {
		plan.unreadable.push(VERSIONS);
		return plan;
	}
	for (const raw of locations) {
		const loc = nameOf(raw);
		if (!loc || !LOCATION_KEY.test(loc)) continue;
		const rel = `${VERSIONS}/${loc}`;
		const dir = path.join(source.root, rel);
		const stats = realDir(dir) ? lstatOrNull(dir) : null;
		if (!stats) continue;
		source.dirs.set(rel, idOf(stats));
		const names = spend(dir);
		if (!names) {
			plan.unreadable.push(rel);
			continue;
		}
		const record = locationRecord(dir, loc);
		if (record === "unreadable") {
			plan.unreadable.push(`${rel}/location.json`);
			continue;
		}
		for (const name of names.map(nameOf)) {
			if (name === null || versionTime(name) === null) continue;
			const meta = record ? listedVersion(dir, loc, name) : null;
			if (meta)
				plan.candidates.push({
					loc,
					name,
					length: meta.length,
					sha256: meta.sha256,
				});
			else plan.unlisted += 1;
		}
		await step(rel);
	}
	plan.candidates.sort((a, b) =>
		byBytes(`${a.loc}/${a.name}`, `${b.loc}/${b.name}`),
	);
	return plan;
}

// One planned version, its payload hash checked in full against the plan. Read in one event-loop turn,
// so this process's history, which is all synchronous, cannot change it midway.
function readVersion(
	dir: string,
	name: string,
	recordedPath: string,
	expected: string,
): { meta: Buffer; payload: Buffer } | null {
	const at = versionTime(name);
	let folder: BigIntStats | null;
	let names: string[];
	try {
		folder = lstatOrNull(dir);
		if (at === null || !folder?.isDirectory()) return null;
		names = sortedEntries(dir, 3).map((raw) => nameOf(raw) ?? "");
	} catch {
		return null;
	}
	if (
		names.length !== 2 ||
		names[0] !== "payload" ||
		names[1] !== "version.json"
	)
		return null;
	const metaBytes = readSmall(path.join(dir, "version.json"));
	let meta: ReturnType<typeof parseVersionMeta> = null;
	try {
		meta = metaBytes ? parseVersionMeta(strict.decode(metaBytes)) : null;
	} catch {
		return null;
	}
	if (
		!meta ||
		meta.capturedAt !== at ||
		meta.recordedPath !== recordedPath ||
		meta.sha256 !== expected
	)
		return null;
	if (
		meta.sha256.slice(0, 16) !== name.split("-")[1] ||
		meta.length > MAX_VERSION_BYTES
	)
		return null;
	const payload = readSmall(path.join(dir, "payload"), meta.length);
	if (
		!payload ||
		payload.length !== meta.length ||
		sha256(payload) !== meta.sha256
	)
		return null;
	try {
		const after = lstatOrNull(dir);
		return after?.isDirectory() && idOf(after) === idOf(folder)
			? { meta: metaBytes as Buffer, payload }
			: null;
	} catch {
		return null;
	}
}

/** Trash items by folder name only, as native's `count_trash`; Trash is never read or copied. */
function countTrash(root: string): number {
	try {
		if (!lstatOrNull(path.join(root, ".leadinglight"))?.isDirectory()) return 0;
		const trash = path.join(root, ".leadinglight", "trash");
		if (!lstatOrNull(trash)?.isDirectory()) return 0;
		let count = 0;
		const handle = opendirSync(trash);
		try {
			for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
				if (!TRASH_ID.test(entry.name)) continue;
				count += 1;
				if (count >= BACKUP_LIMITS.trashItemsCounted) return count;
			}
		} finally {
			handle.closeSync();
		}
		return count;
	} catch {
		return 0;
	}
}

// --- The registry -------------------------------------------------------------------------------

interface Operation {
	id: string;
	kind: OperationKind;
	digest: string;
	phase: Phase;
	progress: Progress | null;
	cancel: boolean;
	/** Past the completion point: a cancel is refused and changes nothing. */
	committed: boolean;
	result: OperationResult | null;
	done: Promise<void>;
}

/** Test seams: awaited at fixed points so a test can cancel, fault or race deterministically. */
export type StepEvent =
	| {
			at: "count" | "chunk" | "file" | "check";
			kind: OperationKind;
			path: string;
	  }
	| {
			at: "afterCopy" | "beforePublish" | "beforeMarker";
			kind: OperationKind;
			path: null;
	  };

export interface DiskBackupOptions {
	now?: () => number;
	appVersion?: string;
	chunkBytes?: number;
	step?: (event: StepEvent) => void | Promise<void>;
	/** Workspace roots besides those this process has backed up; native reads its vault list. */
	workspaceRoots?: () => readonly string[];
	/** Test seam, like native's `ENTRY_CAP`: smaller bounds, exercised without 100,000 files. */
	limits?: { entries?: number; totalPathBytes?: number };
}

type Started = {
	kind: OperationKind;
	run: (op: Operation) => Promise<OperationResult>;
};

export function createDiskBackup(options: DiskBackupOptions = {}) {
	const now = options.now ?? Date.now;
	const appVersion = options.appVersion ?? APP_VERSION;
	const chunk = options.chunkBytes ?? BACKUP_LIMITS.copyBufferBytes;
	const maxEntries = options.limits?.entries ?? BACKUP_LIMITS.entries;
	const maxPathBytes =
		options.limits?.totalPathBytes ?? BACKUP_LIMITS.totalPathBytes;
	const operations = new Map<string, Operation>();
	const finished: string[] = [];
	const backedUp = new Set<string>();
	let running: Operation | null = null;

	const workspaces = () => [
		...backedUp,
		...(options.workspaceRoots?.() ?? []).flatMap((root) => {
			const chosen = choose(root);
			return typeof chosen === "string" ? [] : [chosen.real];
		}),
	];

	async function step(op: Operation, event: StepEvent): Promise<void> {
		await options.step?.(event);
		await nextTurn();
		if (op.cancel && !op.committed) throw new Cancelled();
	}
	/** Native's commit: false when a cancel already won; after true, cancel changes nothing. */
	const commit = (op: Operation) => {
		if (op.cancel) return false;
		op.committed = true;
		return true;
	};
	const report = (op: Operation, phase: Phase, progress: Progress | null) => {
		op.phase = phase;
		op.progress = progress ? { ...progress } : null;
	};

	function begin(id: string, digest: string, started: Started): StartAnswer {
		let settle: () => void = () => {};
		const op: Operation = {
			id,
			kind: started.kind,
			digest,
			phase: "counting",
			progress: null,
			cancel: false,
			committed: false,
			result: null,
			done: new Promise((resolve) => {
				settle = resolve;
			}),
		};
		operations.set(id, op);
		running = op;
		const internal: Record<OperationKind, OperationResult> = {
			backup: {
				status: "failed",
				reason: "internal",
				path: null,
				leftover: null,
			},
			inspect: { status: "failed", reason: "internal" },
			restore: {
				status: "failed",
				reason: "internal",
				path: null,
				leftover: null,
			},
		};
		void started
			.run(op)
			.catch(() => internal[op.kind])
			.then((result) => {
				op.result = result;
				op.progress = null;
				running = null;
				// The newest 16 finished operations are kept; older ids become `unknown`.
				finished.push(id);
				while (finished.length > BACKUP_LIMITS.retainedOperations)
					operations.delete(finished.shift() as string);
				settle();
			});
		return { status: "started" };
	}

	/** Same id: the same answer while retained, a refusal for other arguments. */
	function admit(
		command: BackupCommand,
		args: Record<string, string>,
		prepare: () => StartRefusal | Started,
	): StartAnswer {
		const id = args.operationId;
		if (!isOperationId(id))
			return { status: "refused", reason: "operationMismatch" };
		const digest = JSON.stringify([
			command,
			...Object.keys(args)
				.sort()
				.map((key) => args[key]),
		]);
		const known = operations.get(id);
		if (known) {
			if (known.digest !== digest)
				return { status: "refused", reason: "operationMismatch" };
			return known.result
				? { status: "finished", result: known.result }
				: { status: "started" };
		}
		if (running) return { status: "refused", reason: "busy" };
		const started = prepare();
		return typeof started === "string"
			? { status: "refused", reason: started }
			: begin(id, digest, started);
	}

	// --- Backup -----------------------------------------------------------------------------

	function prepareBackup(args: Record<string, string>): StartRefusal | Started {
		if (!SUPPORTED) return "unavailable";
		const root = choose(args.vaultPath);
		if (typeof root === "string") return "notWorkspace";
		const destination = choose(args.destination);
		if (destination === "missing") return "destinationMissing";
		if (destination === "notFolder") return "destinationNotFolder";
		if (
			[root.real, ...workspaces()].some((known) =>
				inside(known, destination.real),
			)
		)
			return "destinationInWorkspace";
		backedUp.add(root.real);
		return {
			kind: "backup",
			run: (op) =>
				backup(op, {
					vaultShown: args.vaultPath,
					source: new Source(root.real, root.chain),
					destinationShown: args.destination,
					destination,
				}),
		};
	}

	interface Plan {
		files: string[];
		versions: Candidate[];
		gaps: Tally<GapReason>;
		kept: BackupManifest["gaps"];
		versionsSkipped: number;
		trash: number;
		totalFiles: number;
		totalBytes: number;
	}
	function addGap(plan: Plan, relative: string, reason: GapReason): void {
		const shown = boundedText(relative);
		plan.gaps.add(reason, shown);
		if (plan.kept.length < BACKUP_LIMITS.manifestGaps)
			plan.kept.push({ path: shown, reason });
	}

	/** The bounded walk, as native's `count`: nothing is written before it passes, and links are never followed. */
	async function count(op: Operation, source: Source): Promise<Plan> {
		const plan: Plan = {
			files: [],
			versions: [],
			gaps: new Tally(),
			kept: [],
			versionsSkipped: 0,
			trash: 0,
			totalFiles: 0,
			totalBytes: 0,
		};
		if (source.intact("", true) !== true) throw new Fail("io", null);
		let visited = 0;
		let pathBytes = 0;
		const stack: string[] = [""];
		while (stack.length > 0) {
			const folder = stack.pop() as string;
			let names: Buffer[];
			try {
				names = sortedEntries(path.join(source.root, folder), maxEntries);
			} catch (error) {
				if (error instanceof TooLarge) throw error;
				addGap(plan, folder, "unreadable");
				continue;
			}
			const below: string[] = [];
			for (const raw of names) {
				visited += 1;
				if (visited > maxEntries) throw new TooLarge();
				const name = nameOf(raw);
				if (name === null) {
					addGap(plan, join(folder, lossy.decode(raw)), "notText");
					continue;
				}
				const relative = join(folder, name);
				let stats: BigIntStats | null;
				try {
					stats = lstatOrNull(path.join(source.root, relative));
				} catch {
					addGap(plan, relative, "unreadable");
					continue;
				}
				if (!stats) {
					addGap(plan, relative, "missing");
					continue;
				}
				const isDir = stats.isDirectory();
				if (isDir && skipDir(relative)) continue;
				const fault = checkPath(relative);
				if (fault) {
					addGap(plan, relative, fault);
					continue;
				}
				if (isDir) {
					source.dirs.set(relative, idOf(stats));
					below.push(relative);
					continue;
				}
				if (classifyPath(relative) !== "user") continue;
				if (stats.isSymbolicLink()) addGap(plan, relative, "link");
				else if (stats.isFile()) {
					pathBytes += byteLength(relative);
					if (pathBytes > maxPathBytes) throw new TooLarge();
					plan.files.push(relative);
					plan.totalFiles += 1;
					plan.totalBytes += Number(stats.size);
				} else addGap(plan, relative, "special");
			}
			// Depth first, names in byte order, as native's sorted walk.
			stack.push(...below.reverse());
			report(op, "counting", {
				files: plan.totalFiles,
				totalFiles: null,
				bytes: plan.totalBytes,
				totalBytes: null,
			});
			await step(op, { at: "count", kind: "backup", path: folder });
		}
		// The root must still be the one walked.
		if (source.intact("") !== true) throw new Fail("io", null);
		// History shares the walk's budget, spent before anything is kept past it.
		const history = await exportCandidates(
			source,
			{ left: maxEntries - visited },
			(rel) => step(op, { at: "count", kind: "backup", path: rel }),
		);
		for (const rel of history.unreadable) addGap(plan, rel, "unreadable");
		// Native's estimate of the three stored paths per version, so both sides refuse the same size.
		const versionPathBytes = history.candidates.reduce(
			(sum, v) => sum + 3 * (STORE.length + v.loc.length + v.name.length + 40),
			0,
		);
		if (
			plan.files.length + history.candidates.length * 3 > maxEntries ||
			pathBytes + versionPathBytes > maxPathBytes
		)
			throw new TooLarge();
		plan.versions = history.candidates;
		plan.versionsSkipped = history.unlisted;
		plan.totalFiles += history.candidates.length;
		for (const version of history.candidates) plan.totalBytes += version.length;
		plan.trash = countTrash(source.root);
		return plan;
	}

	function folderName(vaultShown: string, attempt: number): string {
		const date = new Date(now());
		const pad = (value: number) => String(value).padStart(2, "0");
		const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
		const base = `${displayName(path.basename(vaultShown))} backup ${stamp}`;
		return attempt === 1 ? base : `${base} ${attempt}`;
	}

	/** Failure paths name the workspace file, as native's do, not our output folder's layout. */
	const shownPath = (at: string | null) =>
		at?.startsWith(`${WORKSPACE_FOLDER}/`)
			? at.slice(WORKSPACE_FOLDER.length + 1)
			: at;

	async function backup(
		op: Operation,
		job: {
			vaultShown: string;
			source: Source;
			destinationShown: string;
			destination: Chosen;
		},
	): Promise<BackupResult> {
		let output: Output | null = null;
		const leftover = () => output?.cleanup() ?? null;
		try {
			const plan = await count(op, job.source);
			if (op.cancel) throw new Cancelled();
			for (let attempt = 1; !output; attempt += 1) {
				if (attempt > 99) throw new Fail("destinationNotWritable", null);
				output = Output.create(
					job.destinationShown,
					job.destination,
					folderName(job.vaultShown, attempt),
					"destinationNotWritable",
				);
			}
			const out: Output = output;
			out.folder(WORKSPACE_FOLDER);
			const progress: Progress = {
				files: 0,
				totalFiles: plan.totalFiles,
				bytes: 0,
				totalBytes: plan.totalBytes,
			};
			report(op, "copying", progress);
			const files: BackupManifest["files"] = [];
			for (const relative of plan.files) {
				const destination = `${WORKSPACE_FOLDER}/${relative}`;
				let fd: number | null = null;
				const read = await job.source.read(
					relative,
					chunk,
					{
						open: () => {
							fd = out.create(destination);
						},
						write: (bytes) => {
							out.write(fd as number, bytes, destination);
							progress.bytes += bytes.length;
						},
						abandon: () => {
							if (fd !== null) closeSync(fd);
							fd = null;
							if (!out.drop(destination))
								throw new Fail("destinationChanged", relative);
						},
					},
					() => step(op, { at: "chunk", kind: "backup", path: relative }),
				);
				if (typeof read === "string") addGap(plan, relative, read);
				else {
					out.finish(
						fd as unknown as number,
						destination,
						read.sha256,
						read.bytes,
					);
					files.push({ path: relative, ...read });
				}
				progress.files += 1;
				report(op, "copying", progress);
				await step(op, { at: "file", kind: "backup", path: relative });
			}
			let versionsSkipped = plan.versionsSkipped;
			const recorded = new Set<string>();
			// As native: saved-version files carry the backup folder's time, not the store's.
			let made: BigIntStats | null;
			try {
				made = lstatOrNull(out.real);
			} catch {
				made = null;
			}
			if (!made) throw new Fail("io", null);
			const time = millis(made);
			const write = (relative: string, bytes: Buffer) => {
				out.put(`${WORKSPACE_FOLDER}/${relative}`, bytes);
				files.push({
					path: relative,
					bytes: bytes.length,
					sha256: sha256(bytes),
					modifiedMs: time,
				});
				progress.bytes += bytes.length;
			};
			for (const version of plan.versions) {
				const base = `${VERSIONS}/${version.loc}`;
				const dir = path.join(job.source.root, base);
				const record =
					job.source.intact(base) === true
						? locationRecord(dir, version.loc)
						: null;
				const found =
					record && record !== "unreadable"
						? readVersion(
								path.join(dir, version.name),
								version.name,
								record.recordedPath,
								version.sha256,
							)
						: null;
				if (!record || record === "unreadable" || !found) {
					// Pruned or changed since the walk: owned history, so skipped, not a gap.
					versionsSkipped += 1;
					continue;
				}
				if (!recorded.has(version.loc)) {
					write(`${base}/location.json`, record.bytes);
					recorded.add(version.loc);
				}
				write(`${base}/${version.name}/version.json`, found.meta);
				write(`${base}/${version.name}/payload`, found.payload);
				progress.files += 1;
				report(op, "copying", progress);
				await step(op, { at: "file", kind: "backup", path: base });
			}
			await step(op, { at: "afterCopy", kind: "backup", path: null });

			report(op, "checking", null);
			for (const file of files) {
				// Once per file too, so even empty files let status and cancel in.
				await step(op, { at: "check", kind: "backup", path: file.path });
				const ok = await out.reread(
					`${WORKSPACE_FOLDER}/${file.path}`,
					chunk,
					() => step(op, { at: "chunk", kind: "backup", path: file.path }),
				);
				if (!ok) throw new Fail("checkFailed", file.path);
			}

			report(op, "finishing", null);
			files.sort((a, b) => byBytes(a.path, b.path));
			const gapsTotal = plan.gaps.total;
			const manifest: BackupManifest = {
				format: MANIFEST_FORMAT,
				version: MANIFEST_VERSION,
				appVersion,
				createdAt: isoSeconds(now()),
				workspaceName: displayName(path.basename(job.vaultShown)),
				status: gapsTotal === 0 ? "complete" : "incomplete",
				files,
				gaps: plan.kept,
				gapsTotal,
				versionsSkipped,
				trashItemsNotIncluded: plan.trash,
				totalFiles: files.length,
				totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
			};
			const text = Buffer.from(serializeManifest(manifest), "utf8");
			if (text.length > BACKUP_LIMITS.manifestBytes)
				throw new Fail("manifestTooLarge", null);
			const synced = out.syncFolders();
			const temp = `.leadinglight-manifest-${randomBytes(8).toString("hex")}`;
			out.put(temp, text);
			await step(op, { at: "beforePublish", kind: "backup", path: null });
			if (job.source.intact("") !== true) throw new Fail("io", null);
			if (!out.stillOurs()) throw new Fail("destinationChanged", null);
			if (!commit(op)) throw new Cancelled();
			try {
				// A hard link never replaces a file: publication without clobbering, like `persist_noclobber`.
				linkSync(path.join(out.real, temp), path.join(out.real, MANIFEST_NAME));
			} catch (error) {
				if (errorCode(error) === "EEXIST")
					throw new Fail("destinationChanged", null);
				throw writeFailure(error, null, "destinationNotWritable");
			}
			// Completion point passed: the manifest exists. Nothing below undoes or cancels it.
			out.drop(temp);
			const durable =
				synced && out.syncFolders() && fsyncFolder(job.destination.real);
			return {
				status: manifest.status,
				folder: out.shown,
				folderName: path.basename(out.real),
				files: files.length,
				bytes: manifest.totalBytes,
				durable,
				gaps: plan.gaps.result(),
				versionsSkipped,
				trashItemsNotIncluded: plan.trash,
			};
		} catch (error) {
			if (error instanceof Cancelled)
				return { status: "cancelled", leftover: leftover() };
			if (error instanceof TooLarge)
				return {
					status: "failed",
					reason: "tooLarge",
					path: null,
					leftover: leftover(),
				};
			if (error instanceof Fail)
				return {
					status: "failed",
					reason: error.reason as BackupFailure,
					path: shownPath(error.at),
					leftover: leftover(),
				};
			return {
				status: "failed",
				reason: "internal",
				path: null,
				leftover: leftover(),
			};
		}
	}

	// --- Inspection and restore ---------------------------------------------------------------

	function prepareInspect(given: string): StartRefusal | Chosen {
		if (!SUPPORTED) return "unavailable";
		const backup = choose(given);
		if (backup === "missing") return "backupMissing";
		if (backup === "notFolder") return "backupNotFolder";
		return backup;
	}

	/** The manifest bytes within the bound, never through a link; as native's `read_manifest`. */
	function readManifest(
		backup: string,
	): Buffer | "missing" | "tooLarge" | "unusable" {
		const target = path.join(backup, MANIFEST_NAME);
		let fd: number | null = null;
		try {
			const stats = lstatOrNull(target);
			if (!stats) return "missing";
			if (!stats.isFile()) return "unusable";
			if (stats.size > BigInt(BACKUP_LIMITS.manifestBytes)) return "tooLarge";
			fd = openSync(target, READ);
			if (idOf(fstatSync(fd, { bigint: true })) !== idOf(stats))
				return "unusable";
			return readExactly(fd, Number(stats.size)) ?? "unusable";
		} catch {
			return "unusable";
		} finally {
			if (fd !== null) closeSync(fd);
		}
	}

	/** A gap while reading a listed file, named as native's `gap_problem`. */
	const problemOf = (reason: GapReason): Problem => {
		if (reason === "missing") return "missing";
		if (reason === "link" || reason === "special") return "notRegularFile";
		if (reason === "unreadable") return "unreadable";
		if (reason === "changing") return "hashMismatch";
		return "badPath";
	};

	/** The backup's `workspace/` as a source, or null when it is not a real folder. */
	function workspaceOf(backup: Chosen): Source | null {
		const real = path.join(backup.real, WORKSPACE_FOLDER);
		try {
			const stats = lstatOrNull(real);
			if (!stats?.isDirectory() || !sameChain(backup.chain)) return null;
			return new Source(real, [...backup.chain, { at: real, id: idOf(stats) }]);
		} catch {
			return null;
		}
	}

	/** Entries under `workspace/` the manifest does not list; bounded as native's, never followed. */
	async function extraFiles(
		op: Operation,
		top: string,
		listed: Set<string>,
	): Promise<number | null> {
		const budget = maxEntries * 2;
		let visited = 0;
		let extra = 0;
		const stack: string[] = [""];
		while (stack.length > 0) {
			const folder = stack.pop() as string;
			let names: Buffer[];
			try {
				names = sortedEntries(path.join(top, folder), budget);
			} catch (error) {
				if (error instanceof TooLarge) return null;
				continue;
			}
			for (const raw of names) {
				visited += 1;
				if (visited >= budget) return null;
				const name = nameOf(raw);
				if (name === null) {
					extra += 1;
					continue;
				}
				const relative = join(folder, name);
				let stats: BigIntStats | null = null;
				try {
					stats = lstatOrNull(path.join(top, relative));
				} catch {
					stats = null;
				}
				if (stats?.isDirectory()) {
					if (depthOf(relative) <= BACKUP_LIMITS.pathSegments)
						stack.push(relative);
				} else if (!listed.has(relative)) extra += 1;
			}
			await step(op, { at: "count", kind: "inspect", path: folder });
		}
		return extra;
	}

	async function inspect(
		op: Operation,
		backup: Chosen,
	): Promise<InspectResult> {
		try {
			report(op, "checking", null);
			const bytes = readManifest(backup.real);
			if (bytes === "missing") return { status: "notBackup" };
			if (bytes === "tooLarge")
				return {
					status: "damaged",
					problems: oneProblem("manifestTooLarge", null),
				};
			if (bytes === "unusable")
				return {
					status: "damaged",
					problems: oneProblem("manifestInvalid", null),
				};
			const checked = validateManifest(bytes);
			if (!checked.ok) return { status: "damaged", problems: checked.problems };
			const { manifest } = checked;
			const workspace = workspaceOf(backup);
			if (!workspace)
				return {
					status: "damaged",
					problems: oneProblem("missing", WORKSPACE_FOLDER),
				};
			const progress: Progress = {
				files: 0,
				totalFiles: manifest.totalFiles,
				bytes: 0,
				totalBytes: manifest.totalBytes,
			};
			report(op, "checking", progress);
			const problems = new Tally<Problem>();
			const ignore: Sink = {
				open: () => {},
				write: () => {},
				abandon: () => {},
			};
			for (const file of manifest.files) {
				await step(op, { at: "file", kind: "inspect", path: file.path });
				let size: bigint | null = null;
				try {
					size =
						lstatOrNull(path.join(workspace.root, file.path))?.size ?? null;
				} catch {
					size = null;
				}
				if (size !== null && size !== BigInt(file.bytes))
					problems.add("sizeMismatch", file.path);
				else {
					const read = await workspace.read(
						file.path,
						chunk,
						ignore,
						() => step(op, { at: "chunk", kind: "inspect", path: file.path }),
						true,
					);
					if (typeof read === "string")
						problems.add(problemOf(read), file.path);
					else if (read.sha256 !== file.sha256 || read.bytes !== file.bytes)
						problems.add("hashMismatch", file.path);
				}
				progress.files += 1;
				progress.bytes += file.bytes;
				report(op, "checking", progress);
			}
			// Completion point: the last file was checked; a later cancel changes nothing.
			op.committed = true;
			const extra = await extraFiles(
				op,
				workspace.root,
				new Set(manifest.files.map((file) => file.path)),
			);
			if (extra === null) problems.add("tooLarge", null);
			if (problems.total > 0)
				return { status: "damaged", problems: problems.result() };
			return {
				status: "ok",
				manifestSha256: sha256(bytes),
				createdAt: manifest.createdAt,
				appVersion: manifest.appVersion,
				workspaceName: manifest.workspaceName,
				backupStatus: manifest.status,
				files: manifest.totalFiles,
				bytes: manifest.totalBytes,
				gaps: manifest.gapsTotal,
				extraFiles: extra ?? 0,
			};
		} catch (error) {
			if (error instanceof Cancelled) return { status: "cancelled" };
			return { status: "failed", reason: errorCode(error) ? "io" : "internal" };
		}
	}

	function prepareRestore(
		args: Record<string, string>,
	): StartRefusal | Started {
		const backup = prepareInspect(args.backupPath);
		if (typeof backup === "string") return backup;
		const parent = choose(args.parent);
		if (parent === "missing") return "parentMissing";
		if (parent === "notFolder") return "parentNotFolder";
		if (workspaces().some((root) => inside(root, parent.real)))
			return "parentInWorkspace";
		if (inside(backup.real, parent.real)) return "parentInBackup";
		if (!nameOk(args.name)) return "nameInvalid";
		return {
			kind: "restore",
			run: (op) =>
				restore(op, {
					backup,
					manifestSha256: args.manifestSha256,
					parentShown: args.parent,
					parent,
					name: args.name,
				}),
		};
	}

	async function restore(
		op: Operation,
		job: {
			backup: Chosen;
			manifestSha256: string;
			parentShown: string;
			parent: Chosen;
			name: string;
		},
	): Promise<RestoreResult> {
		let output: Output | null = null;
		const marker = {
			name: RESTORE_MARKER,
			bytes: Buffer.from(
				`{"manifestSha256":"${job.manifestSha256}"}\n`,
				"utf8",
			),
		};
		const leftover = () => output?.cleanup(marker) ?? null;
		try {
			report(op, "checking", null);
			// Inspection is not authority: the bytes are read again and bound to what was inspected.
			if (!sameChain(job.backup.chain))
				throw new Changed("missing", MANIFEST_NAME);
			const bytes = readManifest(job.backup.real);
			if (bytes === "missing")
				throw new Changed("manifestMissing", MANIFEST_NAME);
			if (bytes === "tooLarge")
				throw new Changed("manifestTooLarge", MANIFEST_NAME);
			if (bytes === "unusable")
				throw new Changed("manifestInvalid", MANIFEST_NAME);
			if (sha256(bytes) !== job.manifestSha256)
				throw new Changed("hashMismatch", MANIFEST_NAME);
			const checked = validateManifest(bytes);
			if (!checked.ok) return { status: "damaged", problems: checked.problems };
			const { manifest } = checked;
			const workspace = workspaceOf(job.backup);
			if (!workspace) throw new Changed("missing", WORKSPACE_FOLDER);

			output = Output.create(
				job.parentShown,
				job.parent,
				job.name,
				"parentNotWritable",
			);
			if (!output) return { status: "nameTaken" };
			const out: Output = output;
			out.put(marker.name, marker.bytes);

			const progress: Progress = {
				files: 0,
				totalFiles: manifest.totalFiles,
				bytes: 0,
				totalBytes: manifest.totalBytes,
			};
			report(op, "copying", progress);
			let timesKept = true;
			for (const file of manifest.files) {
				let fd: number | null = null;
				const read = await workspace.read(
					file.path,
					chunk,
					{
						open: () => {
							fd = out.create(file.path);
						},
						write: (bytes) => {
							out.write(fd as number, bytes, file.path);
							progress.bytes += bytes.length;
						},
						abandon: () => {
							if (fd !== null) closeSync(fd);
							fd = null;
							if (!out.drop(file.path))
								throw new Fail("destinationChanged", null);
						},
					},
					() => step(op, { at: "chunk", kind: "restore", path: file.path }),
					true,
				);
				const opened = fd as number | null;
				let problem: Problem | null = null;
				if (typeof read === "string") problem = problemOf(read);
				else if (read.bytes !== file.bytes) problem = "sizeMismatch";
				else if (read.sha256 !== file.sha256) problem = "hashMismatch";
				if (problem) {
					if (opened !== null) closeSync(opened);
					throw new Changed(problem, file.path);
				}
				try {
					const time = file.modifiedMs / 1000;
					futimesSync(opened as number, time, time);
				} catch {
					timesKept = false;
				}
				out.finish(opened as number, file.path, file.sha256, file.bytes);
				progress.files += 1;
				report(op, "copying", progress);
				await step(op, { at: "file", kind: "restore", path: file.path });
			}
			await step(op, { at: "afterCopy", kind: "restore", path: null });

			report(op, "checking", null);
			for (const file of manifest.files) {
				await step(op, { at: "check", kind: "restore", path: file.path });
				const ok = await out.reread(file.path, chunk, () =>
					step(op, { at: "chunk", kind: "restore", path: file.path }),
				);
				if (!ok) throw new Fail("checkFailed", file.path);
			}

			report(op, "finishing", null);
			const synced = out.syncFolders();
			await step(op, { at: "beforeMarker", kind: "restore", path: null });
			if (!out.stillOurs()) throw new Fail("destinationChanged", null);
			if (!commit(op)) throw new Cancelled();
			// Completion point: the marker goes. If that cannot be done or confirmed, the tree stays
			// marked unfinished and is reported, never as a completed restore.
			let gone = out.drop(RESTORE_MARKER);
			try {
				gone =
					gone && lstatOrNull(path.join(out.real, RESTORE_MARKER)) === null;
			} catch {
				gone = false;
			}
			if (!gone)
				return {
					status: "failed",
					reason: "io",
					path: RESTORE_MARKER,
					leftover: out.shown,
				};
			return {
				status: "restored",
				folder: out.shown,
				folderName: job.name,
				files: manifest.totalFiles,
				bytes: manifest.totalBytes,
				durable: synced && out.syncFolders() && fsyncFolder(job.parent.real),
				timesKept,
			};
		} catch (error) {
			if (error instanceof Changed)
				return {
					status: "backupChanged",
					problems: oneProblem(error.problem, error.at),
					leftover: leftover(),
				};
			if (error instanceof Cancelled)
				return { status: "cancelled", leftover: leftover() };
			if (error instanceof Fail)
				return {
					status: "failed",
					reason: error.reason as RestoreFailure,
					path: error.at,
					leftover: leftover(),
				};
			return {
				status: "failed",
				reason: "internal",
				path: null,
				leftover: leftover(),
			};
		}
	}

	// --- Commands -----------------------------------------------------------------------------

	function start(command: BackupCommand, raw: unknown): StartAnswer {
		const args = argsOf(command, raw);
		if (command === BACKUP_COMMANDS.startBackup)
			return admit(command, args, () => prepareBackup(args));
		if (command === BACKUP_COMMANDS.startInspection)
			return admit(command, args, () => {
				const backup = prepareInspect(args.backupPath);
				return typeof backup === "string"
					? backup
					: { kind: "inspect", run: (op) => inspect(op, backup) };
			});
		return admit(command, args, () => prepareRestore(args));
	}

	function status(raw: unknown): OperationState {
		const { operationId } = argsOf(BACKUP_COMMANDS.getOperation, raw);
		const op = operations.get(operationId);
		if (!op) return { state: "unknown" };
		if (op.result)
			return {
				state: "finished",
				kind: op.kind,
				result: op.result,
			} as OperationState;
		return {
			state: "running",
			kind: op.kind,
			phase: op.phase,
			progress: op.progress ? { ...op.progress } : null,
			cancelRequested: op.cancel,
		};
	}

	/** Accepted only while running and before the completion point, as native's `request_cancel`. */
	function cancel(raw: unknown): CancelAnswer {
		const { operationId } = argsOf(BACKUP_COMMANDS.cancelOperation, raw);
		const op = operations.get(operationId);
		if (!op || op.result || op.committed) return { accepted: false };
		op.cancel = true;
		return { accepted: true };
	}

	function run(command: BackupCommand, args: unknown): unknown {
		if (command === BACKUP_COMMANDS.getOperation) return status(args);
		if (command === BACKUP_COMMANDS.cancelOperation) return cancel(args);
		return start(command, args);
	}

	/** Test seam: resolves once this operation has its result. */
	const settled = async (operationId: string) =>
		operations.get(operationId)?.done;

	return { run, start, status, cancel, settled };
}

// Vaults the browser has listed through this server: the bridge's stand-in for native's vault list.
const listedRoots = new Set<string>();
export function noteWorkspaceRoot(vaultPath: unknown): void {
	if (typeof vaultPath === "string" && listedRoots.size < 1000)
		listedRoots.add(vaultPath);
}

/** This dev server's one backup registry, like native's for the app's process. */
export const diskBackup = createDiskBackup({
	workspaceRoots: () => [...listedRoots],
});

export async function runDiskBackup(
	command: BackupCommand,
	body: unknown,
): Promise<{ payload: unknown; statusCode: number }> {
	try {
		return { payload: diskBackup.run(command, body), statusCode: 200 };
	} catch (error) {
		if (error instanceof BackupArgumentError)
			return { payload: { error: error.message }, statusCode: 400 };
		throw error;
	}
}
