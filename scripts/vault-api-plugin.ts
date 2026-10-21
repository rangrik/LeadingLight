import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import {
	runVaultCommand,
	type VaultCommandPayload,
	vaultCommandContext,
} from "./vault-api-commands.ts";
import { pathExists, writeUtf8File } from "./vault-api-data.ts";
import {
	autoRenameUntitledOnDisk,
	moveNoteToFolderOnDisk,
	renameNoteFilenameOnDisk,
	renameNoteOnDisk,
	type RenameResponse,
} from "./vault-api-rename.ts";
import { noteWorkspaceRoot, runDiskBackup } from "./vault-api-backup.ts";
import { handleExtensionApiRequest, noteExtensionVault } from "./vault-api-extensions.ts";
import { heldPathRefusal, runDiskHistory, runDiskSaveRecovery } from "./vault-api-save-recovery.ts";
import { listTrash, moveToTrash, restoreFromTrash } from "./vault-api-trash.ts";
import { HISTORY_COMMANDS } from "../src/mock-tauri/mock-history.ts";
import { BACKUP_COMMAND_LIST } from "../src/mock-tauri/mock-backup.ts";
import { type SaveRecoveryCommand, VAULT_API_MARKER } from "../src/mock-tauri/mock-save-recovery.ts";

function sendJson(
	res: ServerResponse,
	payload: unknown,
	statusCode = 200,
): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

// Like native: a held page refuses other mutations; 409 keeps the browser from a silent fallback.
function refuseHeld(res: ServerResponse, paths: readonly unknown[]): boolean {
	const held = heldPathRefusal(paths);
	if (held) sendJson(res, { error: held }, 409);
	return held !== null;
}

const VAULT_ENDPOINT_ARG_KEYS = [
	"path",
	"vault_path",
	"query",
	"mode",
	"reload",
	"exclude_frontmatter",
	"limit",
] as const;

function readVaultQueryArgs(url: URL): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	for (const key of VAULT_ENDPOINT_ARG_KEYS) {
		const value = url.searchParams.get(key);
		if (value !== null) Reflect.set(args, key, value);
	}
	return args;
}

async function readVaultEndpointArgs(
	url: URL,
	req: IncomingMessage,
): Promise<Record<string, unknown>> {
	if (req.method === "POST") return readJsonBody<Record<string, unknown>>(req);
	return readVaultQueryArgs(url);
}

async function saveVaultContent(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const { path: filePath, content } = await readJsonBody<{
		path?: string;
		content?: string;
	}>(req);
	if (!filePath || content === undefined) {
		sendJson(res, { error: "Missing path or content" }, 400);
		return;
	}
	if (refuseHeld(res, [filePath])) return;

	mkdirSync(path.dirname(filePath), { recursive: true });
	writeUtf8File(filePath, content);
	sendJson(res, null);
}

// Like native create_note_content: never replaces an existing file.
async function createVaultContent(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const { path: filePath, content } = await readJsonBody<{
		path?: string;
		content?: string;
	}>(req);
	if (!filePath || content === undefined) {
		sendJson(res, { error: "Missing path or content" }, 400);
		return;
	}
	mkdirSync(path.dirname(filePath), { recursive: true });
	try {
		writeFileSync(filePath, content, { encoding: "utf-8", flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		sendJson(res, { error: `File already exists: ${filePath}` }, 409);
		return;
	}
	sendJson(res, null);
}

// Managed renames: exact ordinary-link transforms and native-shaped receipts.
function renameRoute(run: (body: Record<string, unknown>) => RenameResponse): VaultRoute {
	return {
		write: async ({ req, res }) => {
			const response = run(await readJsonBody<Record<string, unknown>>(req));
			sendJson(res, response.payload, response.statusCode);
		},
		fallback: "Rename failed",
	};
}

interface VaultRoute {
	cmd?: string;
	write?: (context: VaultRequest) => Promise<void>;
	fallback: string;
}
interface VaultRequest {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
}
// The native S0 save commands, one route each, so a test can stand at each command's boundary.
const SAVE_RECOVERY_ROUTES: [string, VaultRoute][] = (
	[
		["save-page-content", "save_page_content"],
		["check-save-outcome", "check_save_outcome"],
		["save-draft-as-new-page", "save_draft_as_new_page"],
		["release-hold-with-copy", "release_hold_with_copy"],
		["discard-hold", "discard_hold"],
	] as const
).map(([route, command]): [string, VaultRoute] => [
	route,
	{ write: (request) => runSaveRecoveryRoute(request, command), fallback: "Save recovery failed" },
]);
async function runSaveRecoveryRoute({ req, res }: VaultRequest, command: SaveRecoveryCommand): Promise<void> {
	const response = await runDiskSaveRecovery(command, await readJsonBody<unknown>(req));
	sendJson(res, response.payload, response.statusCode);
}
// The S1a page-history commands, the same way: `list_page_versions` at `list-page-versions`.
const HISTORY_ROUTES: [string, VaultRoute][] = HISTORY_COMMANDS.map((command): [string, VaultRoute] => [
	command.replaceAll("_", "-"),
	{
		write: async ({ req, res }) => {
			const response = await runDiskHistory(command, await readJsonBody<unknown>(req));
			sendJson(res, response.payload, response.statusCode);
		},
		fallback: "Page history failed",
	},
]);
// M6 backup, inspection and restore, the same way: `start_workspace_backup` at `start-workspace-backup`.
const BACKUP_ROUTES: [string, VaultRoute][] = BACKUP_COMMAND_LIST.map((command): [string, VaultRoute] => [
	command.replaceAll("_", "-"),
	{
		write: async ({ req, res }) => {
			const response = await runDiskBackup(command, await readJsonBody<unknown>(req));
			sendJson(res, response.payload, response.statusCode);
		},
		fallback: "Backup failed",
	},
]);
const VAULT_ROUTES = new Map<string, VaultRoute>([
	["list", { cmd: "list_vault", fallback: "Vault read failed" }],
	["content", { cmd: "get_note_content", fallback: "Vault read failed" }],
	["all-content", { cmd: "get_all_content", fallback: "Vault read failed" }],
	["entry", { cmd: "reload_vault_entry", fallback: "Vault read failed" }],
	["search", { cmd: "search_vault", fallback: "Vault read failed" }],
	[
		"save",
		{
			write: ({ req, res }) => saveVaultContent(req, res),
			fallback: "Save failed",
		},
	],
	[
		"create",
		{
			write: ({ req, res }) => createVaultContent(req, res),
			fallback: "Create failed",
		},
	],
	["rename", renameRoute(renameNoteOnDisk)],
	["rename-filename", renameRoute(renameNoteFilenameOnDisk)],
	["move-note-to-folder", renameRoute(moveNoteToFolderOnDisk)],
	["auto-rename-untitled", renameRoute(autoRenameUntitledOnDisk)],
	["delete", { write: deleteVaultNote, fallback: "Delete failed" }],
	["trash-move", { write: (request) => runTrashRoute(request, (body) => moveToTrash(body.vault_path, body.paths ?? []), true), fallback: "Trash failed" }],
	["trash-list", { write: (request) => runTrashRoute(request, (body) => listTrash(body.vault_path)), fallback: "Trash failed" }],
	["trash-restore", { write: (request) => runTrashRoute(request, (body) => restoreFromTrash(body.vault_path, body.ids ?? [])), fallback: "Restore failed" }],
	["command", { write: executeVaultCommand, fallback: "Vault command failed" }],
	...SAVE_RECOVERY_ROUTES,
	...HISTORY_ROUTES,
	...BACKUP_ROUTES,
]);
interface TrashBody {
	vault_path: string;
	paths?: string[];
	ids?: string[];
}
async function runTrashRoute(
	{ req, res }: VaultRequest,
	run: (body: TrashBody) => unknown,
	moves = false,
): Promise<void> {
	const body = await readJsonBody<TrashBody>(req);
	// A vault that is not on disk is refused; only the browser's mock vault then answers from memory.
	if (!body.vault_path || !pathExists(body.vault_path)) {
		sendJson(res, { error: "Missing vault path" }, 400);
		return;
	}
	const vaultPath = body.vault_path;
	if (moves && refuseHeld(res, (body.paths ?? []).map((input) => path.resolve(vaultPath, input)))) return;
	sendJson(res, run(body));
}
async function deleteVaultNote({ req, res }: VaultRequest): Promise<void> {
	const { path: filePath } = await readJsonBody<{ path?: string }>(req);
	if (!filePath) {
		sendJson(res, { error: "Missing path" }, 400);
		return;
	}
	if (refuseHeld(res, [filePath])) return;
	unlinkSync(filePath);
	sendJson(res, filePath);
}
async function executeVaultCommand({ req, res }: VaultRequest): Promise<void> {
	const context = vaultCommandContext(
		await readJsonBody<VaultCommandPayload>(req),
	);
	if (!context) {
		sendJson(res, { error: "Invalid vault command" }, 400);
		return;
	}
	const response = runVaultCommand(context);
	sendJson(res, response.payload, response.statusCode);
}
function acceptsVaultMethod({
	route,
	method,
}: {
	route: VaultRoute;
	method?: string;
}): boolean {
	return method === "POST" || Boolean(route.cmd && method === "GET");
}
async function dispatchVaultRoute({
	route,
	request,
}: {
	route: VaultRoute;
	request: VaultRequest;
}): Promise<void> {
	if (route.write) {
		await route.write(request);
		return;
	}
	const args = await readVaultEndpointArgs(request.url, request.req);
	// A listed vault is a workspace this server knows, so backups and restores stay out of it,
	// and the only kind of vault where extensions may create pages.
	if (route.cmd === "list_vault") {
		noteWorkspaceRoot(args.path);
		noteExtensionVault(args.path);
	}
	const response = runVaultCommand({ args, cmd: route.cmd ?? "" });
	sendJson(request.res, response.payload, response.statusCode);
}
async function handleVaultApiRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	if (url.pathname === "/api/vault/ping") {
		sendJson(res, { ok: true });
		return true;
	}
	if (!url.pathname.startsWith("/api/vault/")) return false;
	const route = VAULT_ROUTES.get(url.pathname.replace(/^\/api\/vault\//, ""));
	if (!route) return false;
	if (!acceptsVaultMethod({ route, method: req.method })) {
		if (!route.cmd) return false;
		sendJson(res, { error: "Unsupported method" }, 405);
		return true;
	}
	try {
		await dispatchVaultRoute({ route, request: { req, res, url } });
	} catch (err: unknown) {
		sendCaughtError(res, err, route.fallback);
	}
	return true;
}

export function vaultApiPlugin(): Plugin {
	return {
		name: "vault-api",
		apply: "serve",
		// Tells the browser a disk vault is reachable, so its writes never fall back to memory.
		transformIndexHtml: () => [{ tag: "meta", attrs: { name: VAULT_API_MARKER, content: "disk" }, injectTo: "head-prepend" }],
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (await handleExtensionApiRequest(req, res)) return;
				if (await handleVaultApiRequest(req, res)) return;
				next();
			});
		},
	};
}

// --- Proxy helpers ---

function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
	});
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
	return JSON.parse(await readRequestBody(req)) as T;
}

function sendCaughtError(
	res: ServerResponse,
	err: unknown,
	fallback: string,
): void {
	sendJson(res, { error: err instanceof Error ? err.message : fallback }, 500);
}
