// Bridge side of the ignored native test bridge_and_native_read_each_others_versions (history_tests.rs; ADR 007).
// One JSON request on stdin, one JSON answer on stdout. It drives the real disk bridge, never the store files.
import { createHash, randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { HISTORY_LIMITS } from "../src/mock-tauri/mock-history.ts";
import {
	createDiskPageHistory,
	diskSaveRecovery,
} from "./vault-api-save-recovery.ts";

const MARKER_FILE = ".leadinglight-synthetic-vault";
const MARKER_TEXT = "leadinglight synthetic vault\n";

/** A request this helper will not act on; nothing was read or written for it. */
class Refused extends Error {}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
	throw new Error(message);
};
// Reads and copies only: this helper never starts bridge maintenance itself.
const history = createDiskPageHistory({ schedule: () => {} });

/** The vault only when it is a marked folder inside the OS temp folder; other paths are never touched. */
function vaultOf(request) {
	const vault = request.vault;
	if (typeof vault !== "string" || !path.isAbsolute(vault))
		throw new Refused("vault must be an absolute path");
	const temp = realpathSync(os.tmpdir());
	const inside = (base, target) => target.startsWith(`${base}${path.sep}`);
	if (
		![path.resolve(os.tmpdir()), temp].some((base) =>
			inside(base, path.resolve(vault)),
		)
	)
		throw new Refused("vault must be inside the OS temp folder");
	let marker = null;
	try {
		const real = realpathSync(vault);
		const file = path.join(real, MARKER_FILE);
		const stats = lstatSync(file);
		if (inside(temp, real) && stats.isFile() && stats.size <= 64)
			marker = readFileSync(file, "utf8");
	} catch {
		// Missing or unreadable: refused below.
	}
	if (marker !== MARKER_TEXT)
		throw new Refused(
			`vault needs ${MARKER_FILE} holding ${JSON.stringify(MARKER_TEXT)}`,
		);
	return vault;
}

function pageOf(request, vault) {
	const page = request.page;
	const parts = typeof page === "string" ? page.split("/") : [""];
	const safe = parts.every(
		(part) =>
			part &&
			part !== "." &&
			part !== ".." &&
			!part.includes("\\") &&
			!part.startsWith(".leadinglight"),
	);
	if (!safe || !page.endsWith(".md"))
		throw new Refused(
			"page must be a vault-relative .md path outside .leadinglight",
		);
	return path.join(vault, ...parts);
}

/** UTF-8 bytes of a text field, small enough to compare whole against the preview. */
function bytesOf(request, field) {
	const text = request[field];
	if (typeof text !== "string" || text === "")
		throw new Refused(`${field} must be non-empty text`);
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length > HISTORY_LIMITS.previewBytes)
		throw new Refused(
			`${field} must be at most ${HISTORY_LIMITS.previewBytes} bytes`,
		);
	return bytes;
}

/** Every page of a listing until `found` matches; the bridge pages 100 rows at a time. */
function search(list, found) {
	let cursor = null;
	for (let page = 0; page < 100; page += 1) {
		const answer = list(cursor);
		if (answer.status !== "ok")
			fail(`listing answered ${JSON.stringify(answer)}`);
		const match = (answer.versions ?? answer.locations).find(found);
		if (match || !answer.nextCursor) return match ?? null;
		cursor = answer.nextCursor;
	}
	return fail("more than 100 pages to search");
}

const versionWith = (vault, pagePath, sha256) =>
	search(
		(cursor) =>
			history.listPageVersions({ vaultPath: vault, path: pagePath, cursor }),
		(row) => row.sha256 === sha256,
	) ?? fail(`no listed version has sha256 ${sha256}`);

/** Writes `beforeText` when the page is absent, then saves `afterText` through the bridge's S0 save. */
async function produce(request) {
	const vault = vaultOf(request);
	const pagePath = pageOf(request, vault);
	const before = bytesOf(request, "beforeText");
	const after = bytesOf(request, "afterText");
	if (before.equals(after))
		throw new Refused("afterText must differ from beforeText");
	let current = null;
	try {
		current = readFileSync(pagePath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (current === null) {
		mkdirSync(path.dirname(pagePath), { recursive: true });
		writeFileSync(pagePath, before, { flag: "wx" });
	} else if (!current.equals(before))
		fail("the page exists with bytes other than beforeText");
	const outcome = await diskSaveRecovery.savePageContent({
		request: {
			requestId: randomUUID(),
			vaultPath: vault,
			session: "cross-reader",
			path: pagePath,
			seq: 1,
			submittedSha256: sha(after),
		},
		content: request.afterText,
	});
	if (
		outcome.status !== "committed" ||
		!outcome.written ||
		outcome.history !== null
	)
		fail(`save answered ${JSON.stringify(outcome)}`);
	if (!readFileSync(pagePath).equals(after))
		fail("the page does not hold afterText");
	return {
		version: versionWith(vault, pagePath, sha(before)),
		beforeSha256: sha(before),
		afterSha256: sha(after),
	};
}

/** Finds `expectedText` among the page's versions, previews and copies it, and keeps the page as it was. */
function verify(request) {
	const vault = vaultOf(request);
	const pagePath = pageOf(request, vault);
	const expected = bytesOf(request, "expectedText");
	const currentBytes = bytesOf(request, "currentText");
	const unchanged = () => readFileSync(pagePath).equals(currentBytes);
	if (!unchanged()) fail("the page does not hold currentText");

	const version = versionWith(vault, pagePath, sha(expected));
	if (
		version.recordedPath !== request.page ||
		version.length !== expected.length
	)
		fail(`listed row differs: ${JSON.stringify(version)}`);
	const shown = {
		status: "ok",
		text: request.expectedText,
		length: expected.length,
		shownBytes: expected.length,
		truncated: false,
		bom: expected[0] === 0xef && expected[1] === 0xbb && expected[2] === 0xbf,
		crlf: request.expectedText.includes("\r\n"),
	};
	const preview = history.readPageVersion({
		vaultPath: vault,
		id: version.id,
		sha256: version.sha256,
	});
	if (!isDeepStrictEqual(preview, shown))
		fail(`preview answered ${JSON.stringify(preview)}`);

	const copy = history.savePageVersionAsCopy({
		vaultPath: vault,
		id: version.id,
		sha256: version.sha256,
		folder: null,
		operationId: randomUUID(),
	});
	if (copy.status !== "created" || !readFileSync(copy.path).equals(expected))
		fail(`copy answered ${JSON.stringify(copy)}`);
	if (!unchanged()) fail("the original page changed");

	const location =
		search(
			(cursor) => history.listSavedLocations({ vaultPath: vault, cursor }),
			(row) => row.path === request.page,
		) ?? fail(`no saved location ${request.page}`);
	if (!location.exists)
		fail(`saved location answered ${JSON.stringify(location)}`);
	return { version, copy, location };
}

const operations = { produce, verify };
try {
	let request;
	try {
		request = JSON.parse(readFileSync(0, "utf8"));
	} catch {
		throw new Refused("stdin must be one JSON object");
	}
	const op = request?.op;
	if (!Object.hasOwn(operations, op))
		throw new Refused('op must be "produce" or "verify"');
	const answer = await operations[op](request);
	process.stdout.write(`${JSON.stringify({ ok: true, op, ...answer })}\n`);
} catch (error) {
	process.exitCode = error instanceof Refused ? 2 : 1;
	process.stdout.write(
		`${JSON.stringify({ ok: false, error: error.message })}\n`,
	);
}
