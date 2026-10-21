import { lstatSync, mkdirSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
	collectVaultSearchResults,
	findMarkdownFiles,
	parseMarkdownFile,
	pathExists,
	readUtf8File,
	searchResultLimit,
	writeUtf8File,
} from "./vault-api-data.ts";
import {
	autoRenameUntitledOnDisk,
	moveNoteToFolderOnDisk,
	renameNoteFilenameOnDisk,
	renameNoteOnDisk,
} from "./vault-api-rename.ts";
import { heldPathRefusal } from "./vault-api-save-recovery.ts";

type VaultCommandHandler = (
	context: VaultCommandContext,
) => VaultCommandResponse;
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
	// The requested bound is kept exactly; a refused one is an error, never a smaller page of results.
	const limit = searchResultLimit(Reflect.get(args, "limit"));
	if (limit === null)
		return commandResponse({ payload: { error: "Invalid search limit" }, statusCode: 400 });
	const results =
		vaultPath && query
			? collectVaultSearchResults({ vaultPath, query, excludeFrontmatter, limit })
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

// Managed renames: the same exact-link transforms and receipts as native (vault-api-rename.ts).
const commandVaultRename: VaultCommandHandler = ({ args }) => renameNoteOnDisk(args);
const commandVaultRenameFilename: VaultCommandHandler = ({ args }) => renameNoteFilenameOnDisk(args);
const commandVaultMoveToFolder: VaultCommandHandler = ({ args }) => moveNoteToFolderOnDisk(args);
const commandVaultAutoRename: VaultCommandHandler = ({ args }) => autoRenameUntitledOnDisk(args);

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
	["move_note_to_folder", commandVaultMoveToFolder],
	["auto_rename_untitled", commandVaultAutoRename],
	["save_note_content", commandVaultSave],
	["search_vault", commandVaultSearch],
	["validate_note_content", commandVaultContent],
]);

// The page each mutating command touches; native refuses these while that page is held.
const HELD_GUARDED_ARGS = new Map<string, string>([
	["delete_note", "path"],
	["rename_note", "old_path"],
	["rename_note_filename", "old_path"],
	["move_note_to_folder", "old_path"],
	["auto_rename_untitled", "note_path"],
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
