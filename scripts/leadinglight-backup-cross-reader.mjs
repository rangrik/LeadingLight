// Bridge side of the native<->bridge backup cross-reader: one JSON request on stdin, one answer line out.
// Every path must be a marked folder inside the OS temp folder, so no real vault is ever touched.
import { createHash, randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDiskBackup } from "./vault-api-backup.ts";
import { diskSaveRecovery } from "./vault-api-save-recovery.ts";

const VAULT_MARKER = [
	".leadinglight-synthetic-vault",
	"leadinglight synthetic vault\n",
];
const OUTPUT_MARKER = [
	".leadinglight-synthetic-output",
	"leadinglight synthetic output\n",
];

/** A request this helper will not act on; nothing was read or written for it. */
class Refused extends Error {}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
	throw new Error(message);
};

const temps = () => [path.resolve(os.tmpdir()), realpathSync(os.tmpdir())];
const under = (base, target) => target.startsWith(`${base}${path.sep}`);

/** An absolute folder inside the OS temp folder that holds the given marker, or a refusal. */
function marked(value, field, [file, text]) {
	if (typeof value !== "string" || !path.isAbsolute(value))
		throw new Refused(`${field} must be an absolute path`);
	if (!temps().some((base) => under(base, path.resolve(value))))
		throw new Refused(`${field} must be inside the OS temp folder`);
	let found = null;
	try {
		const real = realpathSync(value);
		const stats = lstatSync(path.join(real, file));
		if (under(temps()[1], real) && stats.isFile() && stats.size <= 64)
			found = readFileSync(path.join(real, file), "utf8");
	} catch {
		// Missing or unreadable: refused below.
	}
	if (found !== text)
		throw new Refused(`${field} needs ${file} holding ${JSON.stringify(text)}`);
	return value;
}
const vaultOf = (request) => marked(request.vault, "vault", VAULT_MARKER);
const outputOf = (value, field) => marked(value, field, OUTPUT_MARKER);
/** A backup folder: its parent is a marked output folder. */
function backupOf(request) {
	const backup = request.backup;
	if (typeof backup !== "string" || !path.isAbsolute(backup))
		throw new Refused("backup must be an absolute path");
	outputOf(path.dirname(backup), "backup's parent");
	return backup;
}

// --- The shared fixture -------------------------------------------------------------------------

/** Bytes every reader must keep exactly: BOM, CRLF, all 256 byte values, nested hidden views. */
const FILES = {
	"notes/plan.md": "# Plan\n\nBridge and native read each other.\n",
	"notes/windows.md": "﻿# Windows\r\n\r\nLines end in CRLF.\r\n",
	"assets/every-byte.bin": Buffer.from(
		Array.from({ length: 512 }, (_, i) => i % 256),
	),
	".laputa/views/board.json": '{"kind":"board","columns":["Now","Later"]}\n',
	"Notes With Spaces/ünïcödé page.md": "# Ünïcödé\n\nNon-ASCII path.\n",
};
const HISTORY_PAGE = "notes/history.md";
const HISTORY_BEFORE = "# History\n\nThe earlier words, kept as a version.\n";
const HISTORY_AFTER = "# History\n\nThe later words, saved now.\n";
const TRASH_ID = "0123456789abcdef0123456789abcdef";
/** Never copied, by rule; each is checked absent from every backup and restore. */
const EXCLUDED = {
	".git/HEAD": "ref: refs/heads/main\n",
	".leadinglight-staging/half.md": "half written\n",
	".laputa-cache.json": "{}\n",
	"notes/.DS_Store": "finder\n",
	[`.leadinglight/trash/${TRASH_ID}/record.json`]:
		'{"originalPath":"gone.md"}\n',
	[`.leadinglight/trash/${TRASH_ID}/payload`]: "# Gone\n",
};
// A version-shaped folder history never lists, so a backup skips it. Stamped now so that
// history's retention, which runs after the seeding save, does not prune it.
const BAD_VERSION = `${String(Date.now()).padStart(13, "0")}-0000000000000000-000000`;

async function seed(request) {
	const vault = vaultOf(request);
	const present = readdirSync(vault).filter((name) => name !== VAULT_MARKER[0]);
	if (present.length > 0) throw new Refused("vault must hold only its marker");
	const write = (relative, bytes) => {
		const target = path.join(vault, ...relative.split("/"));
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, bytes, { flag: "wx" });
	};
	for (const [relative, bytes] of Object.entries(FILES)) write(relative, bytes);
	for (const [relative, bytes] of Object.entries(EXCLUDED))
		write(relative, bytes);
	// A real saved version, made by the bridge's own save, so history lists it.
	write(HISTORY_PAGE, HISTORY_BEFORE);
	const saved = await diskSaveRecovery.savePageContent({
		request: {
			requestId: randomUUID(),
			vaultPath: vault,
			session: "backup-cross-reader",
			path: path.join(vault, ...HISTORY_PAGE.split("/")),
			seq: 1,
			submittedSha256: sha(Buffer.from(HISTORY_AFTER)),
		},
		content: HISTORY_AFTER,
	});
	if (saved.status !== "committed" || saved.history !== null)
		fail(`save answered ${JSON.stringify(saved)}`);
	const versions = path.join(vault, ".leadinglight", "history", "versions");
	const locs = readdirSync(versions);
	if (locs.length !== 1)
		fail(`expected one saved location, found ${locs.length}`);
	write(
		`.leadinglight/history/versions/${locs[0]}/${BAD_VERSION}/version.json`,
		"{}",
	);
	write(
		`.leadinglight/history/versions/${locs[0]}/${BAD_VERSION}/payload`,
		"x",
	);
	// A link inside the vault: never followed, one `link` gap, so the backup is incomplete.
	symlinkSync("notes", path.join(vault, "linked"));
	return { expected: expectation(vault) };
}

/** What a backup of the seeded vault holds: every included file with its bytes, and its one gap. */
function expectation(vault) {
	const files = tree(vault).files.filter((file) => {
		const top = file.path.split("/")[0];
		return (
			!Object.hasOwn(EXCLUDED, file.path) &&
			top !== VAULT_MARKER[0] &&
			!file.path.includes(`/${BAD_VERSION}/`) &&
			!(
				top === ".leadinglight" &&
				!file.path.startsWith(".leadinglight/history/versions/")
			)
		);
	});
	return {
		files: files.map(({ path: relative, bytes, sha256 }) => ({
			path: relative,
			bytes,
			sha256,
		})),
		badVersion: BAD_VERSION,
		gaps: [{ path: "linked", reason: "link" }],
		versionsSkipped: 1,
		trashItemsNotIncluded: 1,
	};
}

// --- Reading any tree ---------------------------------------------------------------------------

/** Regular files with bytes, hash and time; links and other entries by path. Never followed. */
function tree(root) {
	const files = [];
	const links = [];
	const others = [];
	const walk = (folder) => {
		for (const name of readdirSync(path.join(root, folder)).sort()) {
			const relative = folder ? `${folder}/${name}` : name;
			const stats = lstatSync(path.join(root, relative));
			if (stats.isSymbolicLink()) links.push(relative);
			else if (stats.isDirectory()) walk(relative);
			else if (stats.isFile()) {
				const bytes = readFileSync(path.join(root, relative));
				files.push({
					path: relative,
					bytes: bytes.length,
					sha256: sha(bytes),
					modifiedMs: Math.trunc(stats.mtimeMs),
				});
			} else others.push(relative);
		}
	};
	walk("");
	return { files, links, others };
}

function treeOf(request) {
	const root = request.root;
	if (typeof root !== "string" || !path.isAbsolute(root))
		throw new Refused("root must be an absolute path");
	try {
		vaultOf({ vault: root });
	} catch {
		// A restored or backed-up tree: its parent, or the backup's parent, is a marked output folder.
		const parent = path.dirname(root);
		try {
			outputOf(parent, "root's parent");
		} catch {
			outputOf(path.dirname(parent), "root's grandparent");
		}
	}
	return { tree: tree(root) };
}

// --- The bridge operations ----------------------------------------------------------------------

const bridge = createDiskBackup();
async function finished(command, args) {
	const operationId = randomUUID();
	const started = bridge.start(command, { operationId, ...args });
	if (started.status === "refused") return { refused: started.reason };
	await bridge.settled(operationId);
	const state = bridge.status({ operationId });
	if (state.state !== "finished")
		fail(`operation ended ${JSON.stringify(state)}`);
	return { result: state.result };
}

async function backup(request) {
	const vault = vaultOf(request);
	const destination = outputOf(request.destination, "destination");
	const answer = await finished("start_workspace_backup", {
		vaultPath: vault,
		destination,
	});
	if (!answer.result?.folder) return answer;
	const bytes = readFileSync(
		path.join(answer.result.folder, "leadinglight-backup.json"),
	);
	return {
		...answer,
		manifestSha256: sha(bytes),
		manifest: JSON.parse(bytes.toString("utf8")),
	};
}

const inspect = (request) =>
	finished("start_backup_inspection", { backupPath: backupOf(request) });

function restore(request) {
	const { manifestSha256, name } = request;
	if (typeof manifestSha256 !== "string" || typeof name !== "string")
		throw new Refused("restore needs manifestSha256 and name");
	return finished("start_backup_restore", {
		backupPath: backupOf(request),
		manifestSha256,
		parent: outputOf(request.parent, "parent"),
		name,
	});
}

const operations = { seed, backup, inspect, restore, tree: treeOf };
try {
	let request;
	try {
		request = JSON.parse(readFileSync(0, "utf8"));
	} catch {
		throw new Refused("stdin must be one JSON object");
	}
	const op = request?.op;
	if (!Object.hasOwn(operations, op))
		throw new Refused(
			`op must be one of ${Object.keys(operations).join(", ")}`,
		);
	const answer = await operations[op](request);
	process.stdout.write(`${JSON.stringify({ ok: true, op, ...answer })}\n`);
} catch (error) {
	process.exitCode = error instanceof Refused ? 2 : 1;
	process.stdout.write(
		`${JSON.stringify({ ok: false, error: error.message })}\n`,
	);
}
