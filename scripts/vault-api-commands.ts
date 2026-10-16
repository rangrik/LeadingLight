import { lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
	collectVaultSearchResults,
	findMarkdownFiles,
	parseMarkdownFile,
	pathExists,
	readUtf8File,
	resolveInside,
	writeUtf8File,
} from "./vault-api-data.ts";
import { heldPathRefusal } from "./vault-api-save-recovery.ts";

type VaultCommandHandler = (
	context: VaultCommandContext,
) => VaultCommandResponse;
interface PathWikilinkUpdateInput {
	newPath: string;
	oldPath: string;
	oldTitle: string;
	vaultPath: string;
}
interface WikilinkTargetUpdateInput {
	excludePath: string;
	newTarget: string;
	oldTargets: string[];
	vaultPath: string;
}
interface LegacyWikilinkTargetInput {
	oldPath: string;
	oldTitle: string;
	vaultPath: string;
}
interface CommandResponseInput {
	payload: unknown;
	statusCode?: number;
}
interface CommandStringInput {
	args: Record<string, unknown>;
	key: string;
}
interface VaultCommandResponse {
	payload: unknown;
	statusCode?: number;
}
interface VaultCommandContext {
	args: Record<string, unknown>;
	cmd: string;
}
export interface VaultCommandPayload {
	args?: Record<string, unknown>;
	cmd?: string;
}
function commandString({ args, key }: CommandStringInput): string | null {
	const value = Reflect.get(args, key);
	return typeof value === "string" && value.length > 0 ? value : null;
}

function commandBool({ args, key }: CommandStringInput): boolean {
	const value = Reflect.get(args, key);
	return value === true || value === "1" || value === "true";
}

function commandResponse({
	payload,
	statusCode = 200,
}: CommandResponseInput): VaultCommandResponse {
	return { payload, statusCode };
}

function invalidPathResponse(): VaultCommandResponse {
	return commandResponse({
		payload: { error: "Invalid or missing path" },
		statusCode: 400,
	});
}

function existingCommandPath(input: CommandStringInput): string | null {
	const filePath = commandString(input);
	return filePath && pathExists(filePath) ? filePath : null;
}

function commandVaultList({ args }: VaultCommandContext): VaultCommandResponse {
	const dirPath = existingCommandPath({ args, key: "path" });
	if (!dirPath) return invalidPathResponse();

	const entries = findMarkdownFiles(dirPath)
		.map(parseMarkdownFile)
		.filter(Boolean);
	return commandResponse({ payload: entries });
}

function commandVaultContent({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const filePath = existingCommandPath({ args, key: "path" });
	if (!filePath && missingScopedFile(args)) return commandResponse({ payload: { error: "ENOENT: page is missing" }, statusCode: 404 });
	if (!filePath || !insideExplicitRoot(args, filePath)) return invalidPathResponse();
	return commandResponse({ payload: { content: readUtf8File(filePath) } });
}

function commandVaultAllContent({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const dirPath = existingCommandPath({ args, key: "path" });
	if (!dirPath) return invalidPathResponse();

	const contentMap: Record<string, string> = {};
	for (const filePath of findMarkdownFiles(dirPath)) {
		try {
			Reflect.set(contentMap, filePath, readUtf8File(filePath));
		} catch {
			// Skip unreadable files.
		}
	}
	return commandResponse({ payload: contentMap });
}

function commandVaultEntry({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const filePath = existingCommandPath({ args, key: "path" });
	if (!filePath || !insideExplicitRoot(args, filePath)) return invalidPathResponse();
	return commandResponse({ payload: parseMarkdownFile(filePath) });
}

/** Match native's explicit-vault exact read; aliases may not escape the captured root. */
function insideExplicitRoot(args: Record<string, unknown>, filePath: string): boolean {
	const root = commandString({ args, key: "vault_path" });
	if (!root) return true;
	try {
		const relative = path.relative(realpathSync(root), realpathSync(filePath));
		return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
	} catch { return false; }
}

/** Only an absent file under an existing, validated parent authorizes an exclusive same-path retry. */
function missingScopedFile(args: Record<string, unknown>): boolean {
	const filePath = commandString({ args, key: "path" });
	if (!filePath || !commandString({ args, key: "vault_path" }) || !insideExplicitRoot(args, path.dirname(filePath))) return false;
	try { lstatSync(filePath); return false; }
	catch (error) { return error instanceof Error && Reflect.get(error, "code") === "ENOENT"; }
}

function commandVaultSearch({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const vaultPath = commandString({ args, key: "vault_path" });
	const query = (commandString({ args, key: "query" }) ?? "").toLowerCase();
	const mode = commandString({ args, key: "mode" }) ?? "all";
	const excludeFrontmatter = commandBool({ args, key: "exclude_frontmatter" });
	const results =
		vaultPath && query
			? collectVaultSearchResults({ vaultPath, query, excludeFrontmatter })
			: [];
	return commandResponse({
		payload: { results, elapsed_ms: results.length > 0 ? 1 : 0, query, mode },
	});
}

function commandVaultSave({ args }: VaultCommandContext): VaultCommandResponse {
	const filePath = commandString({ args, key: "path" });
	const content = Reflect.get(args, "content");
	if (!filePath || typeof content !== "string")
		return commandResponse({
			payload: { error: "Missing path or content" },
			statusCode: 400,
		});

	mkdirSync(path.dirname(filePath), { recursive: true });
	writeUtf8File(filePath, content);
	return commandResponse({ payload: null });
}

function commandVaultRename({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const oldPath = commandString({ args, key: "old_path" });
	const newTitle = commandString({ args, key: "new_title" });
	if (!oldPath || !newTitle)
		return commandResponse({
			payload: { error: "Missing rename input" },
			statusCode: 400,
		});

	const vaultPath = commandString({ args, key: "vault_path" });
	const oldContent = readUtf8File(oldPath);
	const oldTitle = oldContent.match(/^# (.+)$/m)?.[1]?.trim() ?? "";
	const slug = newTitle
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
	const newPath = markdownSiblingPath(oldPath, slug);
	if (!newPath)
		return commandResponse({
			payload: { error: "Invalid title" },
			statusCode: 400,
		});

	writeUtf8File(newPath, oldContent.replace(/^# .+$/m, `# ${newTitle}`));
	if (newPath !== oldPath) unlinkSync(oldPath);

	const updatedFiles = vaultPath
		? updatePathWikilinks({ newPath, oldPath: newPath, oldTitle, vaultPath })
		: 0;
	return commandResponse({
		payload: { new_path: newPath, updated_files: updatedFiles },
	});
}

export function filenameRenameTitle(oldPath: string): string {
	return parseMarkdownFile(oldPath)?.title ?? path.basename(oldPath, ".md");
}

function commandVaultRenameFilename({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const oldPath = commandString({ args, key: "old_path" });
	if (!oldPath)
		return commandResponse({
			payload: { error: "Missing old path" },
			statusCode: 400,
		});

	const filename = validateMarkdownFilenameStem(
		commandString({ args, key: "new_filename_stem" }),
	);
	if (!filename.ok)
		return commandResponse({
			payload: { error: filename.error },
			statusCode: 400,
		});

	const newPath = markdownSiblingPath(oldPath, filename.stem);
	if (!newPath)
		return commandResponse({
			payload: { error: "Invalid filename" },
			statusCode: 400,
		});
	if (newPath !== oldPath && pathExists(newPath)) {
		return commandResponse({
			payload: { error: "A note with that name already exists" },
			statusCode: 409,
		});
	}

	const vaultPath = commandString({ args, key: "vault_path" });
	const oldTitle = filenameRenameTitle(oldPath);
	renameSync(oldPath, newPath);
	const updatedFiles = vaultPath
		? updatePathWikilinks({ newPath, oldPath, oldTitle, vaultPath })
		: 0;
	return commandResponse({
		payload: { new_path: newPath, updated_files: updatedFiles },
	});
}

function commandVaultDelete({
	args,
}: VaultCommandContext): VaultCommandResponse {
	const filePath = commandString({ args, key: "path" });
	if (!filePath)
		return commandResponse({
			payload: { error: "Missing path" },
			statusCode: 400,
		});
	unlinkSync(filePath);
	return commandResponse({ payload: filePath });
}

const VAULT_COMMAND_HANDLERS = new Map<string, VaultCommandHandler>([
	["delete_note", commandVaultDelete],
	["get_all_content", commandVaultAllContent],
	["get_note_content", commandVaultContent],
	["list_vault", commandVaultList],
	["reload_vault", commandVaultList],
	["reload_vault_entry", commandVaultEntry],
	["rename_note", commandVaultRename],
	["rename_note_filename", commandVaultRenameFilename],
	["save_note_content", commandVaultSave],
	["search_vault", commandVaultSearch],
	["validate_note_content", commandVaultContent],
]);

// The page each mutating command touches; native refuses these while that page is held.
const HELD_GUARDED_ARGS = new Map<string, string>([
	["delete_note", "path"],
	["rename_note", "old_path"],
	["rename_note_filename", "old_path"],
	["save_note_content", "path"],
]);

export function runVaultCommand(
	context: VaultCommandContext,
): VaultCommandResponse {
	const guarded = HELD_GUARDED_ARGS.get(context.cmd);
	const held = guarded ? heldPathRefusal([Reflect.get(context.args, guarded)]) : null;
	if (held) return commandResponse({ payload: { error: held }, statusCode: 409 });
	const handler = VAULT_COMMAND_HANDLERS.get(context.cmd);
	if (handler) return handler(context);
	return commandResponse({
		payload: { error: "Unsupported vault command" },
		statusCode: 404,
	});
}

export function vaultCommandContext(
	payload: VaultCommandPayload,
): VaultCommandContext | null {
	if (!payload.cmd || !payload.args) return null;
	return { cmd: payload.cmd, args: payload.args };
}

function collectLegacyWikilinkTargets({
	oldPath,
	oldTitle,
	vaultPath,
}: LegacyWikilinkTargetInput): string[] {
	const oldRelativeStem = path
		.relative(vaultPath, oldPath)
		.replace(/\.md$/i, "");
	const oldFilenameStem = path.basename(oldPath, ".md");
	return [
		...new Set([oldTitle, oldRelativeStem, oldFilenameStem].filter(Boolean)),
	];
}

function updateWikilinksForTargets({
	excludePath,
	newTarget,
	oldTargets,
	vaultPath,
}: WikilinkTargetUpdateInput): number {
	if (oldTargets.length === 0) return 0;
	const allFiles = findMarkdownFiles(vaultPath);
	const targets = new Set(oldTargets);
	let updatedFiles = 0;
	for (const filePath of allFiles) {
		if (filePath === excludePath) continue;
		try {
			const content = readUtf8File(filePath);
			const replaced = content.replace(
				/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g,
				(match: string, target: string, pipe: string | undefined) => {
					if (!targets.has(target)) return match;
					return pipe ? `[[${newTarget}${pipe}]]` : `[[${newTarget}]]`;
				},
			);
			if (replaced !== content) {
				writeUtf8File(filePath, replaced);
				updatedFiles++;
			}
		} catch {
			// Skip unreadable files in the dev vault API.
		}
	}
	return updatedFiles;
}

export function updatePathWikilinks({
	newPath,
	oldPath,
	oldTitle,
	vaultPath,
}: PathWikilinkUpdateInput): number {
	const newRelativeStem = path
		.relative(vaultPath, newPath)
		.replace(/\.md$/i, "");
	const oldTargets = collectLegacyWikilinkTargets({
		oldPath,
		oldTitle,
		vaultPath,
	});
	return updateWikilinksForTargets({
		excludePath: newPath,
		newTarget: newRelativeStem,
		oldTargets,
		vaultPath,
	});
}

export function validateMarkdownFilenameStem(
	value: unknown,
): FilenameStemValidation {
	const stem = String(value ?? "")
		.trim()
		.replace(/\.md$/i, "")
		.trim();
	if (!stem) return { ok: false, error: "New filename cannot be empty" };
	if (isUnsafeMarkdownFilenameStem(stem))
		return { ok: false, error: "Invalid filename" };
	return { ok: true, stem };
}

function isUnsafeMarkdownFilenameStem(stem: string): boolean {
	return (
		stem === "." || stem === ".." || stem.includes("/") || stem.includes("\\")
	);
}

export function markdownSiblingPath(
	filePath: string,
	stem: string,
): string | null {
	if (isUnsafeMarkdownFilenameStem(stem)) return null;
	return resolveInside(path.dirname(filePath), `${stem}.md`);
}

type FilenameStemValidation =
	| { ok: true; stem: string }
	| { ok: false; error: string };
