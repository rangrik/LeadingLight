// Dev-server page history on synthetic fixture vaults: native's §5 store layout on real files.
// In-process claims only; Node cannot take native's OS lock, so cross-process exclusion is native-only.
import { randomBytes } from "node:crypto";
import {
	type BigIntStats,
	closeSync,
	constants,
	type Dir,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	opendirSync,
	openSync,
	readSync,
	renameSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	type FoundVersion,
	HISTORY_LIMITS,
	type HistoryLimits,
	type HistoryStore,
	type Inventory,
	LOCATION_KEY,
	parseVersionMeta,
	type StoredLocation,
	type StoredVersion,
	type TmpEntry,
	tmpKind,
	type VersionCopyJob,
	type VersionCopyOutcome,
	versionTime,
} from "../src/mock-tauri/mock-history.ts";

const VERSION_FILES = ["payload", "version.json"];
// A recognized folder never holds more than its two files, so reading stops soon after.
const SMALL_FOLDER = 8;
const SMALL_FILE = 4096;

/** What the S0 bridge already does correctly, passed in so the two never disagree. */
export interface S0Parts {
	realRoot(root: string): string | null;
	canonicalPage(page: string): string | null;
	/** `.leadinglight/history`, created as real folders with its `.gitignore`. */
	historyDir(rootReal: string): string;
	syncFolder(folder: string): boolean;
	/** S0's no-clobber copy pipeline with a `version-copy-<op>.json` intent. */
	copyVersion(job: VersionCopyJob, rootReal: string): VersionCopyOutcome;
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const lstatOrNull = (target: string): BigIntStats | null => {
	try {
		return lstatSync(target, { bigint: true });
	} catch (error) {
		if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR")
			return null;
		throw error;
	}
};
const storeOf = (rootReal: string) =>
	path.join(rootReal, ".leadinglight", "history");
const vaultRelative = (rootReal: string, target: string) =>
	path.relative(rootReal, target).split(path.sep).join("/");

/** Reads at most `most` entries without following any of them; null means there were more. */
function readSome(dir: string, most: number) {
	const entries: { name: string; kind: "file" | "dir" | "link" | "other" }[] =
		[];
	let handle: Dir | null = null;
	try {
		handle = opendirSync(dir);
		for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
			if (entries.length === most) return null;
			entries.push({
				name: entry.name,
				kind: entry.isSymbolicLink()
					? "link"
					: entry.isDirectory()
						? "dir"
						: entry.isFile()
							? "file"
							: "other",
			});
		}
		return entries;
	} finally {
		handle?.closeSync();
	}
}

/** Exactly `length` bytes, or null when the file holds more or fewer; never reads past one extra byte. */
export function readExactly(fd: number, length: number): Buffer | null {
	const buffer = Buffer.alloc(length + 1);
	let total = 0;
	while (total < buffer.length) {
		const read = readSync(fd, buffer, total, buffer.length - total, null);
		if (read === 0) break;
		total += read;
	}
	return total === length ? buffer.subarray(0, length) : null;
}

/** A plain file's exact bytes without following a link; null when it is not plain or not that long. */
function readPlain(file: string, length: number): Buffer | null {
	const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		return fstatSync(fd).isFile() ? readExactly(fd, length) : null;
	} finally {
		closeSync(fd);
	}
}

/** A small JSON file's text; null when absent, not plain or too large. A real read error throws. */
function readSmall(file: string): string | null {
	const stats = lstatOrNull(file);
	if (!stats?.isFile() || stats.size > BigInt(SMALL_FILE)) return null;
	try {
		return readPlain(file, Number(stats.size))?.toString("utf8") ?? null;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw error;
	}
}

/** `location.json` holds exactly `{ recordedPath }`; anything else is not understood. A read error throws. */
function readLocation(file: string): string | null {
	const text = readSmall(file);
	try {
		const value = JSON.parse(text ?? "null") as Record<string, unknown> | null;
		const shaped =
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			Object.keys(value).length === 1;
		return shaped && typeof value.recordedPath === "string"
			? value.recordedPath
			: null;
	} catch {
		return null;
	}
}

function emptyInventory(): Inventory {
	return {
		usedBytes: 0,
		versionCount: 0,
		locations: [],
		tmp: [],
		attention: [],
		blocked: null,
	};
}

/** §4: bounded and metadata-only, under the claim; unknown or unaccountable state blocks capture. */
function inventory(rootReal: string, limits: HistoryLimits): Inventory {
	const inv = emptyInventory();
	const flag = (target: string) => {
		inv.attention.push(vaultRelative(rootReal, target));
		inv.blocked ??= "unavailable";
	};
	const full = () => {
		inv.blocked = "full";
	};
	const sizeOf = (file: string) => Number(lstatOrNull(file)?.size ?? 0n);
	for (const dir of [path.join(rootReal, ".leadinglight"), storeOf(rootReal)]) {
		const stats = lstatOrNull(dir);
		if (!stats) return inv;
		if (!stats.isDirectory()) {
			flag(dir);
			return inv;
		}
	}

	// Listable only as exactly its two files, its record matching the folder's time, hash and length.
	function scanVersion(
		dir: string,
		name: string,
		at: number,
	): StoredVersion | null {
		const entries = readSome(dir, SMALL_FOLDER);
		if (!entries) {
			flag(dir);
			return null;
		}
		let bytes = 0;
		let payload = -1;
		let shaped = entries.length === 2;
		for (const entry of entries) {
			if (entry.kind !== "file") {
				flag(path.join(dir, entry.name));
				return null;
			}
			const size = sizeOf(path.join(dir, entry.name));
			bytes += size;
			if (entry.name === "payload") payload = size;
			else if (entry.name !== "version.json") shaped = false;
		}
		let meta = null;
		try {
			meta = shaped
				? parseVersionMeta(readSmall(path.join(dir, "version.json")) ?? "")
				: null;
		} catch {
			// Unreadable is not malformed: it cannot be accounted for, so nothing may delete it.
			flag(path.join(dir, "version.json"));
			return null;
		}
		const listable =
			meta !== null &&
			meta.capturedAt === at &&
			meta.length === payload &&
			meta.sha256.slice(0, 16) === name.split("-")[1];
		return { name, at, meta: listable ? meta : null, bytes };
	}

	function scanLocation(dir: string, loc: string): StoredLocation | null {
		const location: StoredLocation = {
			loc,
			recordedPath: null,
			versions: [],
			complete: true,
		};
		// The location file plus one past the per-location cap is the ceiling.
		const entries = readSome(dir, limits.perLocation + 2);
		if (!entries) {
			location.complete = false;
			full();
		}
		for (const entry of entries ?? []) {
			const target = path.join(dir, entry.name);
			const at = versionTime(entry.name);
			if (entry.kind === "file") {
				inv.usedBytes += sizeOf(target);
				// Unreadable or not understood: its versions are counted, never listed.
				if (entry.name === "location.json") {
					try {
						location.recordedPath = readLocation(target);
					} catch {
						flag(target);
					}
				}
			} else if (entry.kind === "dir" && at !== null) {
				const version = scanVersion(target, entry.name, at);
				if (!version) continue;
				inv.usedBytes += version.bytes;
				inv.versionCount += 1;
				location.versions.push(version);
				if (inv.versionCount > limits.versions) {
					full();
					return null;
				}
			} else flag(target);
		}
		if (location.versions.length > limits.perLocation) {
			location.complete = false;
			full();
		}
		return location;
	}

	try {
		const versions = path.join(storeOf(rootReal), "versions");
		const versionsStats = lstatOrNull(versions);
		if (versionsStats && !versionsStats.isDirectory()) flag(versions);
		else if (versionsStats) {
			const entries = readSome(versions, limits.locations + 1);
			if (!entries) full();
			for (const entry of entries ?? []) {
				const target = path.join(versions, entry.name);
				if (entry.kind === "file") inv.usedBytes += sizeOf(target);
				else if (entry.kind === "dir" && LOCATION_KEY.test(entry.name)) {
					const location = scanLocation(target, entry.name);
					if (!location) break;
					inv.locations.push(location);
				} else flag(target);
			}
		}
		const tmp = path.join(storeOf(rootReal), "tmp");
		const tmpStats = lstatOrNull(tmp);
		if (tmpStats && !tmpStats.isDirectory()) flag(tmp);
		else if (tmpStats && inv.blocked !== "full") {
			const entries = readSome(tmp, limits.tmp + 1);
			if (!entries) full();
			for (const entry of entries ?? []) {
				const target = path.join(tmp, entry.name);
				if (entry.kind === "file") {
					inv.usedBytes += sizeOf(target);
					continue;
				}
				const kind = tmpKind(entry.name);
				// Unknown files inside are counted and kept; a folder or link inside is not accountable.
				const inner =
					entry.kind === "dir" && kind ? readSome(target, SMALL_FOLDER) : null;
				if (!inner || inner.some((f) => f.kind !== "file")) {
					flag(target);
					continue;
				}
				for (const file of inner)
					inv.usedBytes += sizeOf(path.join(target, file.name));
				inv.tmp.push({
					name: entry.name,
					deleting: kind === "delete",
					at: Number(lstatOrNull(target)?.mtimeMs ?? 0n),
				});
			}
		}
	} catch {
		// Unreadable metadata is never followed or deleted; it stops capture until someone looks.
		flag(storeOf(rootReal));
	}
	return inv;
}

/** A real folder, created when missing; only a folder it just made is synced into its parent. */
function ensureFolder(
	target: string,
	syncFolder: S0Parts["syncFolder"],
): string {
	let created = false;
	try {
		mkdirSync(target);
		created = true;
	} catch (error) {
		if (errorCode(error) !== "EEXIST") throw error;
	}
	if (!lstatSync(target).isDirectory())
		throw new Error(`${target} is not a folder`);
	if (created && !syncFolder(path.dirname(target)))
		throw new Error(`${path.dirname(target)} could not be synced`);
	return target;
}

function writeNew(file: string, bytes: Uint8Array | string): void {
	const fd = openSync(file, "wx");
	try {
		writeFileSync(fd, bytes);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

/** Recognized files by name, then the folder; anything else inside keeps it, still counted. */
function removeRecognized(dir: string): boolean {
	for (const name of VERSION_FILES) {
		const file = path.join(dir, name);
		if (lstatOrNull(file)?.isFile()) unlinkSync(file);
	}
	rmdirSync(dir);
	return true;
}

export function diskHistoryStore(s0: S0Parts): HistoryStore {
	const attempt = (run: () => boolean) => {
		try {
			return run();
		} catch {
			return false;
		}
	};
	const tmpDir = (rootReal: string) =>
		ensureFolder(path.join(s0.historyDir(rootReal), "tmp"), s0.syncFolder);

	return {
		root: (vaultPath) => s0.realRoot(vaultPath),
		spot(vaultPath, page) {
			const rootReal = s0.realRoot(vaultPath);
			if (
				!rootReal ||
				!path.isAbsolute(page) ||
				page.split(/[\\/]/).includes("..")
			)
				return null;
			try {
				const canonical = s0.canonicalPage(page);
				const recordedPath = canonical
					? vaultRelative(rootReal, canonical)
					: "";
				const inside =
					recordedPath !== "" &&
					!recordedPath.startsWith("../") &&
					!path.isAbsolute(recordedPath) &&
					!recordedPath
						.split("/")
						.some((part) => part.startsWith(".leadinglight"));
				return inside ? { root: rootReal, recordedPath } : null;
			} catch {
				return null;
			}
		},
		inventory,
		write(rootReal, loc, location, name, payload, meta) {
			let staging: string | null = null;
			try {
				const store = s0.historyDir(rootReal);
				const versions = ensureFolder(
					path.join(store, "versions"),
					s0.syncFolder,
				);
				staging = path.join(
					tmpDir(rootReal),
					`${randomBytes(16).toString("hex")}.tmpv`,
				);
				mkdirSync(staging);
				writeNew(path.join(staging, "payload"), payload);
				writeNew(path.join(staging, "version.json"), meta);
				if (!s0.syncFolder(staging)) throw new Error("tmp version not synced");
				const locDir = ensureFolder(path.join(versions, loc), s0.syncFolder);
				// Exactly the bytes admission reserved; an existing record is never replaced.
				if (location !== null) {
					writeNew(path.join(locDir, "location.json"), location);
					if (!s0.syncFolder(locDir)) throw new Error("location not synced");
				}
				const target = path.join(locDir, name);
				if (lstatOrNull(target)) throw new Error("version name taken");
				renameSync(staging, target);
				staging = null;
				return s0.syncFolder(locDir) ? "kept" : "unavailable";
			} catch (error) {
				// Like native, its own unfinished staging goes now, by name; anything else stays counted.
				if (staging) attempt(() => removeRecognized(staging as string));
				return errorCode(error) === "ENOSPC" ? "lowSpace" : "unavailable";
			}
		},
		remove: (rootReal, loc, name) =>
			attempt(() => {
				const source = path.join(storeOf(rootReal), "versions", loc, name);
				if (!lstatOrNull(source)?.isDirectory()) return false;
				const doomed = path.join(tmpDir(rootReal), `del-${loc}-${name}`);
				renameSync(source, doomed);
				return removeRecognized(doomed);
			}),
		removeTmp: (rootReal, entry: TmpEntry) =>
			attempt(() => {
				const dir = path.join(storeOf(rootReal), "tmp", entry.name);
				return lstatOrNull(dir)?.isDirectory() ? removeRecognized(dir) : false;
			}),
		removeLocation: (rootReal, loc) =>
			attempt(() => {
				const dir = path.join(storeOf(rootReal), "versions", loc);
				const entries = readSome(dir, 2);
				if (
					entries?.length !== 1 ||
					entries[0].name !== "location.json" ||
					entries[0].kind !== "file"
				)
					return false;
				unlinkSync(path.join(dir, "location.json"));
				rmdirSync(dir);
				return true;
			}),
		// Native's rules: no real folder chain or no payload is `missing`; anything unreadable is `damaged`.
		read(rootReal, loc, name): FoundVersion | "missing" | "damaged" {
			const locDir = path.join(storeOf(rootReal), "versions", loc);
			const dir = path.join(locDir, name);
			try {
				for (const part of [
					storeOf(rootReal),
					path.dirname(locDir),
					locDir,
					dir,
				]) {
					if (!lstatOrNull(part)?.isDirectory()) return "missing";
				}
				const payload = path.join(dir, "payload");
				const stats = lstatOrNull(payload);
				if (!stats) return "missing";
				// What listing needs too: exactly its two plain files.
				const entries = readSome(dir, SMALL_FOLDER);
				const shaped =
					entries?.length === 2 &&
					entries.every(
						(entry) =>
							entry.kind === "file" && VERSION_FILES.includes(entry.name),
					);
				const meta = shaped
					? parseVersionMeta(readSmall(path.join(dir, "version.json")) ?? "")
					: null;
				// Never captured above the page limit, whatever the record says; checked before reading.
				if (
					!meta ||
					meta.length > HISTORY_LIMITS.maxPageBytes ||
					!stats.isFile() ||
					stats.size !== BigInt(meta.length)
				)
					return "damaged";
				const bytes = readPlain(payload, meta.length);
				return bytes
					? {
							bytes,
							meta,
							location: readLocation(path.join(locDir, "location.json")),
						}
					: "damaged";
			} catch (error) {
				return errorCode(error) === "ENOENT" ? "missing" : "damaged";
			}
		},
		exists: (rootReal, recordedPath) =>
			Boolean(
				lstatOrNull(path.join(rootReal, ...recordedPath.split("/")))?.isFile(),
			),
		copy: (job) => {
			const rootReal = s0.realRoot(job.vaultPath);
			return rootReal
				? s0.copyVersion(job, rootReal)
				: { status: "refused", reason: "outsideVault" };
		},
	};
}
