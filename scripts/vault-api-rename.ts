import {
	lstatSync,
	type Dirent,
	readdirSync,
	realpathSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	legacyWikilinkTargets,
	rebaseInPlace,
	rebaseOutgoing,
	retargetLinkedPage,
	vaultRelativeStem,
} from "../src/leadinglight/rename/markdownRelocation.ts";
import { RENAME_REFUSED_PREFIX } from "../src/leadinglight/rename/renameRefusal.ts";
import {
	isUntitledFilename,
	normalizeFilenameStem as nativeFilenameStem,
	RenameNameError,
	setFrontmatterTitle,
	slugToTitle,
	titleToSlug,
} from "../src/leadinglight/rename/renameNaming.ts";
import { parseMarkdownFile, readUtf8File, writeUtf8File } from "./vault-api-data.ts";
import { heldPathRefusal } from "./vault-api-save-recovery.ts";

/**
 * Managed renames for synthetic disk vaults in the browser: the same transforms and receipts as
 * native `vault/rename.rs`. It qualifies interface parity only; native owns durability.
 */

export interface RenameResponse {
	payload: unknown;
	statusCode: number;
}

interface OpenPage {
	path: string;
	before_content: string;
	content: string;
}

interface Receipt {
	new_path: string;
	updated_files: number;
	failed_updates: number;
	source_before_content: string;
	source_content: string;
	updated_open_pages: OpenPage[];
	unrefreshed_open_paths: string[];
}

const MAX_OPEN_PAGES = 128;

class Refusal extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 409) {
		super(message);
		this.statusCode = statusCode;
	}
}

const ok = (payload: unknown): RenameResponse => ({ payload, statusCode: 200 });

/**
 * `managedSource`: a managed rename's source path. Its refusals are marked explicit, as native does,
 * only while the source is still in place; anything else (a thrown error, a lost response) is not.
 */
function respond(run: () => unknown, managedSource?: unknown): RenameResponse {
	try {
		return ok(run());
	} catch (error) {
		if (!(error instanceof Refusal)) throw error;
		const source = text(managedSource);
		const explicit = source !== null && path.isAbsolute(source) && statSync(source, { throwIfNoEntry: false }) !== undefined;
		return { payload: { error: explicit ? `${RENAME_REFUSED_PREFIX}${error.message}` : error.message }, statusCode: error.statusCode };
	}
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

function realInside(root: string, target: string, allowRoot = false): boolean {
	try {
		const relative = path.relative(realpathSync(root), realpathSync(target));
		return (allowRoot || relative !== "") && !relative.startsWith("..") && !path.isAbsolute(relative);
	} catch {
		return false;
	}
}

function existingPage(vault: string, page: string): void {
	try {
		if (!statSync(page).isFile() || !realInside(vault, page)) throw new Refusal("Path must stay inside the active vault", 400);
	} catch (error) {
		if (error instanceof Refusal) throw error;
		throw new Refusal(`File does not exist: ${page}`, 404);
	}
}

/** Open pages inside the vault, each once; a page removed meanwhile is reported, not refused. */
function openPages(vault: string, raw: unknown): { existing: string[]; missing: string[] } {
	const paths = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
	if (paths.length > MAX_OPEN_PAGES) throw new Refusal("Too many open pages to safely rename a page", 400);
	const existing: string[] = [];
	const missing: string[] = [];
	const seen = new Set<string>();
	for (const page of paths) {
		if (!path.isAbsolute(page)) throw new Refusal("Path must stay inside the active vault", 400);
		let identity: string;
		try {
			identity = realpathSync(page);
		} catch {
			if (realInside(vault, path.dirname(page), true)) {
				if (!missing.includes(page)) missing.push(page);
				continue;
			}
			throw new Refusal("Path must stay inside the active vault", 400);
		}
		if (!realInside(vault, page)) throw new Refusal("Path must stay inside the active vault", 400);
		if (seen.has(identity)) continue;
		seen.add(identity);
		existing.push(page);
	}
	return { existing, missing };
}

function pageTitle(page: string): string {
	return parseMarkdownFile(page)?.title ?? slugToTitle(path.basename(page, ".md"));
}

/** The page as read; refusal if it changed before publication (native exact recheck). */
function recheck(page: string, before: string): void {
	if (readUtf8File(page) !== before) throw new Refusal("The page changed before it could be renamed");
}

const sameFile = (left: string, right: string) => {
	try {
		const a = statSync(left);
		const b = statSync(right);
		return a.ino === b.ino && a.dev === b.dev;
	} catch {
		return false;
	}
};

/** Publishes at `target` without replacing another page; false when it is occupied. */
function publishAt(oldPath: string, target: string, content: string): boolean {
	if (target === oldPath || sameFile(oldPath, target)) {
		if (target !== oldPath) unlinkSync(oldPath);
		writeUtf8File(target, content);
		return true;
	}
	try {
		writeFileSync(target, content, { encoding: "utf-8", flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
	unlinkSync(oldPath);
	return true;
}

function markdownPages(dir: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		if (entry.name.startsWith(".") || entry.isSymbolicLink()) return [];
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return markdownPages(full);
		return entry.isFile() && path.extname(entry.name) === ".md" ? [full] : [];
	});
}

interface Committed {
	vault: string;
	oldPath: string;
	newPath: string;
	before: string;
	content: string;
	selfLinksUnverified: boolean;
	oldTitle: string;
	open: { existing: string[]; missing: string[] };
}

/** Every linked page, each reread and rechecked; requested open pages always accounted for. */
function finish(committed: Committed): Receipt {
	const { vault, oldPath, newPath, open } = committed;
	const receipt: Receipt = {
		new_path: newPath,
		updated_files: 0,
		failed_updates: Number(committed.selfLinksUnverified),
		source_before_content: committed.before,
		source_content: committed.content,
		updated_open_pages: [],
		unrefreshed_open_paths: [...open.missing],
	};
	const retarget = {
		vault,
		oldPath,
		newPath,
		oldTargets: legacyWikilinkTargets(committed.oldTitle, vaultRelativeStem(oldPath, vault)),
		newTarget: vaultRelativeStem(newPath, vault),
	};
	const unchecked = new Set(open.existing.filter((page) => page !== oldPath && page !== newPath));
	for (const page of markdownPages(vault)) {
		if (page === newPath) continue;
		const requested = unchecked.delete(page);
		try {
			const before = readUtf8File(page);
			const rewrite = retargetLinkedPage(before, page, retarget);
			receipt.failed_updates += Number(rewrite.unverified);
			if (rewrite.content === before) continue;
			if (heldPathRefusal([page]) || readUtf8File(page) !== before) throw new Error("The linked page changed during the rename");
			writeUtf8File(page, rewrite.content);
			receipt.updated_files += 1;
			if (requested) receipt.updated_open_pages.push({ path: page, before_content: before, content: rewrite.content });
		} catch {
			receipt.failed_updates += 1;
			if (requested) receipt.unrefreshed_open_paths.push(page);
		}
	}
	receipt.unrefreshed_open_paths.push(...unchecked);
	receipt.unrefreshed_open_paths.sort();
	return receipt;
}

interface RenameInput {
	vault_path?: unknown;
	old_path?: unknown;
	open_paths?: unknown;
}

function prepare(input: RenameInput) {
	const vault = text(input.vault_path);
	const oldPath = text(input.old_path);
	if (!vault || !oldPath) throw new Refusal("Missing rename input", 400);
	existingPage(vault, oldPath);
	const held = heldPathRefusal([oldPath]);
	if (held) throw new Refusal(held);
	return { vault, oldPath, open: openPages(vault, input.open_paths), before: readUtf8File(oldPath) };
}

const unchanged = (page: string, before: string): Receipt => ({
	new_path: page,
	updated_files: 0,
	failed_updates: 0,
	source_before_content: before,
	source_content: before,
	updated_open_pages: [],
	unrefreshed_open_paths: [],
});

function renameTitle(input: RenameInput & { new_title?: unknown; old_title?: unknown }): Receipt {
	const { vault, oldPath, open, before } = prepare(input);
	const newTitle = String(input.new_title ?? "").trim();
	if (!newTitle) throw new Refusal("New title cannot be empty", 400);
	const oldTitle = text(input.old_title) ?? pageTitle(oldPath);
	const expected = `${titleToSlug(newTitle)}.md`;
	const filename = path.basename(oldPath);
	if (oldTitle === newTitle && filename === expected) return unchanged(oldPath, before);
	const updated = oldTitle === newTitle ? before : setFrontmatterTitle(before, newTitle);
	if (filename === expected) {
		recheck(oldPath, before);
		writeUtf8File(oldPath, updated);
		return { ...unchanged(oldPath, before), source_content: updated };
	}
	const stem = expected.slice(0, -3);
	for (let attempt = 0; ; attempt += 1) {
		const candidate = path.join(path.dirname(oldPath), attempt === 0 ? expected : `${stem}-${attempt + 1}.md`);
		const rebased = rebaseInPlace(updated, vault, oldPath, candidate);
		recheck(oldPath, before);
		if (!publishAt(oldPath, candidate, rebased.content)) continue;
		return finish({ vault, oldPath, newPath: candidate, before, content: rebased.content, selfLinksUnverified: rebased.unverified, oldTitle, open });
	}
}

function renameFilename(input: RenameInput & { new_filename_stem?: unknown }): Receipt {
	const { vault, oldPath, open, before } = prepare(input);
	let stem: string;
	try {
		stem = nativeFilenameStem(input.new_filename_stem);
	} catch (error) {
		if (error instanceof RenameNameError) throw new Refusal(error.message, 400);
		throw error;
	}
	const newPath = path.join(path.dirname(oldPath), `${stem}.md`);
	if (path.basename(oldPath) === `${stem}.md`) return unchanged(oldPath, before);
	const oldTitle = pageTitle(oldPath);
	const rebased = rebaseInPlace(before, vault, oldPath, newPath);
	recheck(oldPath, before);
	if (!publishAt(oldPath, newPath, rebased.content)) throw new Refusal("A note with that name already exists");
	return finish({ vault, oldPath, newPath, before, content: rebased.content, selfLinksUnverified: rebased.unverified, oldTitle, open });
}

function moveToFolder(input: RenameInput & { folder_path?: unknown }): Receipt {
	const { vault, oldPath, open, before } = prepare(input);
	if (lstatSync(oldPath).isSymbolicLink()) throw new Refusal("The page must be a regular, unlinked file before moving");
	const folder = String(input.folder_path ?? "").trim().replace(/^\/+|\/+$/g, "");
	const destination = folder ? path.resolve(vault, folder) : vault;
	if (folder.split(/[/\\]/).includes("..") || !statSync(destination, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Refusal(`Folder does not exist: ${folder}`, 400);
	}
	if (destination !== vault && !realInside(vault, destination)) throw new Refusal("Path must stay inside the active vault", 400);
	const newPath = path.join(destination, path.basename(oldPath));
	if (newPath === oldPath) return unchanged(oldPath, before);
	let rebased: string;
	try {
		// Any unsupported source form refuses before the original path is changed.
		rebased = rebaseOutgoing(before, vault, oldPath, newPath);
	} catch (error) {
		throw new Refusal(error instanceof Error ? error.message : "The page cannot be moved safely");
	}
	const oldTitle = pageTitle(oldPath);
	if (readUtf8File(oldPath) !== before) throw new Refusal("The page changed before it could be moved");
	if (!publishAt(oldPath, newPath, rebased)) throw new Refusal("A note with that name already exists");
	return finish({ vault, oldPath, newPath, before, content: rebased, selfLinksUnverified: false, oldTitle, open });
}

function autoRename(input: { vault_path?: unknown; note_path?: unknown; open_paths?: unknown }): Receipt | null {
	const notePath = text(input.note_path);
	if (!notePath || !isUntitledFilename(path.basename(notePath))) return null;
	const entry = parseMarkdownFile(notePath);
	if (!entry || entry.titleSource !== "h1") return null;
	return renameTitle({ vault_path: input.vault_path, old_path: notePath, new_title: entry.title, open_paths: input.open_paths });
}

export const renameNoteOnDisk = (input: Parameters<typeof renameTitle>[0]) => respond(() => renameTitle(input), input.old_path);
export const renameNoteFilenameOnDisk = (input: Parameters<typeof renameFilename>[0]) =>
	respond(() => renameFilename(input), input.old_path);
// Folder moves keep their own refusal contract (ADR 011); no managed-rename marker.
export const moveNoteToFolderOnDisk = (input: Parameters<typeof moveToFolder>[0]) => respond(() => moveToFolder(input));
export const autoRenameUntitledOnDisk = (input: Parameters<typeof autoRename>[0]) => respond(() => autoRename(input), input.note_path);
