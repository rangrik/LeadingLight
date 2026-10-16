// Dev-server stand-in for the native local Trash commands, used only with synthetic fixture vaults.
// Same shapes and rules: bytes kept, no overwrite on restore, valid items return to their own folder.
import {
	constants,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { parseMarkdownFile } from "./vault-api-data.ts";

interface TrashRecord {
	originalPath: string;
	title: string;
	deletedAt: number;
}

const storeOf = (vault: string) => path.join(vault, ".leadinglight", "trash");

function failureFor(vault: string, input: string): { code: string; message: string } | null {
	const target = path.resolve(vault, input);
	const rel = path.relative(vault, target);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { code: "outsideVault", message: "Outside the vault" };
	if (rel.split(path.sep).some((part) => part.startsWith("."))) return { code: "internalLocation", message: "Internal location" };
	if (!existsSync(target)) return { code: "notFound", message: "File does not exist" };
	const stats = lstatSync(target);
	if (stats.isSymbolicLink()) return { code: "symlink", message: "Symbolic link" };
	if (!stats.isFile()) return { code: "notAFile", message: "Not a file" };
	return null;
}

export function moveToTrash(vault: string, paths: string[]) {
	const moved: { path: string; id: string; originalPath: string }[] = [];
	const failed: { path: string; code: string; message: string }[] = [];
	for (const input of [...new Set(paths)]) {
		const failure = failureFor(vault, input);
		if (failure) {
			failed.push({ path: input, ...failure });
			continue;
		}
		const target = path.resolve(vault, input);
		const originalPath = path.relative(vault, target).split(path.sep).join("/");
		const id = randomBytes(16).toString("hex");
		const itemDir = path.join(storeOf(vault), id);
		mkdirSync(itemDir, { recursive: true });
		const title = parseMarkdownFile(target)?.title ?? path.basename(target);
		const record: TrashRecord = { originalPath, title, deletedAt: Date.now() };
		writeFileSync(path.join(itemDir, "record.json"), JSON.stringify(record));
		renameSync(target, path.join(itemDir, "payload"));
		moved.push({ path: input, id, originalPath });
	}
	return { moved, failed };
}

function readJsonFile<T>(file: string): T | null {
	try {
		return JSON.parse(readFileSync(file, "utf-8")) as T;
	} catch {
		return null;
	}
}

const readRecord = (itemDir: string) => readJsonFile<TrashRecord>(path.join(itemDir, "record.json"));
// Written when a restored page is published but its Trash copy could not be removed yet.
const readRestored = (itemDir: string) => readJsonFile<{ restoredPath: string }>(path.join(itemDir, "restored.json"));

/** Removes the Trash copy of a published page; true when nothing is left. */
function tidy(itemDir: string, restoredPath: string): boolean {
	try {
		rmSync(itemDir, { recursive: true });
		return true;
	} catch {
		try {
			writeFileSync(path.join(itemDir, "restored.json"), JSON.stringify({ restoredPath }));
		} catch {
			// The page is already published; the next listing retries.
		}
		return false;
	}
}

export function listTrash(vault: string) {
	const store = storeOf(vault);
	if (!existsSync(store)) return [];
	return readdirSync(store)
		.filter((id) => /^[0-9a-f]{32}$/.test(id))
		.map((id) => {
			const itemDir = path.join(store, id);
			const record = readRecord(itemDir);
			const restored = readRestored(itemDir);
			const payload = path.join(itemDir, "payload");
			const hasPayload = existsSync(payload);
			const filename = record ? path.basename(record.originalPath) : null;
			const state = restored ? "cleanupPending" : !hasPayload ? "missing" : !record ? "needsAttention" : "ready";
			return {
				id,
				state,
				restoredPath: restored?.restoredPath ?? null,
				title: record?.title ?? null,
				filename,
				originalPath: record?.originalPath ?? null,
				deletedAt: record?.deletedAt ?? null,
				fileKind: filename?.endsWith(".md") ? "markdown" : "text",
				sizeBytes: hasPayload ? statSync(payload).size : null,
			};
		})
		.sort((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0));
}

// Exclusive copy: an existing file at the target is never replaced; the next free name is used.
function publish(payload: string, target: string): string {
	const ext = path.extname(target);
	const stem = target.slice(0, target.length - ext.length);
	for (let index = 1; index < 1000; index += 1) {
		const candidate = index === 1 ? target : `${stem}-${index}${ext}`;
		try {
			copyFileSync(payload, candidate, constants.COPYFILE_EXCL);
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new Error("nameUnavailable");
}

export function restoreFromTrash(vault: string, ids: string[]) {
	const restored: unknown[] = [];
	const failed: { id: string; code: string; message: string }[] = [];
	for (const id of [...new Set(ids)]) {
		if (!/^[0-9a-f]{32}$/.test(id)) {
			failed.push({ id, code: "invalidId", message: "Invalid id" });
			continue;
		}
		const itemDir = path.join(storeOf(vault), id);
		const record = readRecord(itemDir);
		const payload = path.join(itemDir, "payload");
		if (!existsSync(itemDir)) {
			failed.push({ id, code: "notFound", message: "No item with that id in Trash" });
			continue;
		}
		const relativeOf = (target: string) => path.relative(vault, target).split(path.sep).join("/");
		const already = readRestored(itemDir);
		if (already) {
			// Already published: return that page again and only retry the cleanup.
			const target = path.resolve(vault, already.restoredPath);
			restored.push({ id, path: target, relativePath: already.restoredPath, renamed: false, relocated: !record,
				cleanupPending: !tidy(itemDir, already.restoredPath), entry: parseMarkdownFile(target) ?? null });
			continue;
		}
		if (!existsSync(payload)) {
			failed.push({ id, code: "payloadMissing", message: "Payload missing" });
			continue;
		}
		const intended = path.resolve(vault, record?.originalPath ?? `recovered-${id.slice(0, 8)}.md`);
		const parent = path.relative(vault, path.dirname(intended));
		const unsafeParent = parent.startsWith("..") || path.isAbsolute(parent) || parent.split(path.sep).some((part) => part.startsWith("."));
		try {
			if (unsafeParent) throw new Error("unsafe parent");
			mkdirSync(path.dirname(intended), { recursive: true });
			if (!lstatSync(path.dirname(intended)).isDirectory()) throw new Error("not a folder");
		} catch {
			failed.push({ id, code: "originalLocationUnavailable", message: "The original folder cannot be used" });
			continue;
		}
		const target = publish(payload, intended);
		restored.push({
			id,
			path: target,
			relativePath: relativeOf(target),
			renamed: target !== intended,
			relocated: !record,
			cleanupPending: !tidy(itemDir, relativeOf(target)),
			entry: parseMarkdownFile(target) ?? null,
		});
	}
	return { restored, failed };
}
