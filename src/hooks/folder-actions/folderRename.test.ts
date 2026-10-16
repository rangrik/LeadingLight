import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarSelection, VaultEntry } from "../../types";
import {
	type FolderTab,
	folderAbsolutePath,
	isWithinPrefix,
	replaceFolderPrefix,
	replaceRelativeFolderPrefix,
	updateSelectionAfterFolderRename,
	updateTabsAfterFolderRename,
} from "./folderActionUtils";
import { useFolderRename } from "./useFolderRename";

vi.mock("../../mock-tauri", () => ({
	isTauri: () => false,
	mockInvoke: vi.fn(),
}));
const { mockInvoke } = await import("../../mock-tauri");
const renameResult = { old_path: "projects", new_path: "work" };

function entry(path: string): VaultEntry {
	return {
		path,
		filename: "note.md",
		title: "Note",
		isA: "Note",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: null,
		archived: false,
		modifiedAt: null,
		createdAt: null,
		fileSize: 10,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		view: null,
		visible: null,
		organized: false,
		favorite: false,
		favoriteIndex: null,
		listPropertiesDisplay: [],
		outgoingLinks: [],
		properties: {},
		hasH1: true,
	};
}

function tab(path: string): FolderTab {
	return { entry: entry(path), content: "Unsaved editor content" };
}

function setupRename(
	selection: SidebarSelection = { kind: "folder", path: "projects/sub" },
) {
	const hold = { commit: vi.fn(), release: vi.fn() };
	const options = {
		vaultPath: "/vault",
		selection,
		setSelection: vi.fn(),
		setTabs: vi.fn(),
		activeTabPathRef: { current: "/vault/projects/sub/note.md" },
		handleSwitchTab: vi.fn(),
		prepareFolderMove: vi.fn(async () => hold),
		reloadFolders: vi.fn().mockResolvedValue([]),
		reloadVault: vi.fn().mockResolvedValue([entry("/vault/work/sub/note.md")]),
		setToastMessage: vi.fn(),
	};
	const hook = renderHook(() => useFolderRename(options));
	act(() => hook.result.current.startFolderRename("projects"));
	return { ...hook, options, hold };
}

describe("folder rename paths", () => {
	it.each([
		["projects", true],
		["projects/sub/note.md", true],
		["projects-archive/note.md", false],
		["other/projects/note.md", false],
		["", false],
	])("matches the tree boundary for %s", (path, expected) => {
		expect(isWithinPrefix({ path, prefix: "projects" })).toBe(expected);
	});

	it.each([
		replaceFolderPrefix,
		replaceRelativeFolderPrefix,
	])("replaces only complete folder prefixes", (replace) => {
		expect(
			replace({ path: "projects", oldPrefix: "projects", newPrefix: "work" }),
		).toBe("work");
		expect(
			replace({
				path: "projects/sub/note.md",
				oldPrefix: "projects",
				newPrefix: "work",
			}),
		).toBe("work/sub/note.md");
		expect(
			replace({
				path: "projects-archive/note.md",
				oldPrefix: "projects",
				newPrefix: "work",
			}),
		).toBe("projects-archive/note.md");
	});

	it.each([
		["/vault", "projects", "/vault/projects"],
		["/vault/", "/projects", "/vault/projects"],
		["/vault/", "", "/vault"],
	])("joins vault %s and folder %s", (vaultPath, folderPath, expected) => {
		expect(folderAbsolutePath({ vaultPath, folderPath })).toBe(expected);
	});
});

describe("folder rename tab synchronization", () => {
	function remapTabs(activePath: string | null) {
		const original = [
			tab("/vault/projects/note.md"),
			tab("/vault/projects/sub/note.md"),
			tab("/vault/projects-archive/note.md"),
		];
		const refreshedEntry = {
			...entry("/vault/work/note.md"),
			title: "Refreshed title",
		};
		let tabs = original;
		const handleSwitchTab = vi.fn();
		updateTabsAfterFolderRename({
			vaultPath: "/vault/",
			renameResult,
			refreshedEntries: [refreshedEntry],
			activeTabPathRef: { current: activePath },
			handleSwitchTab,
			setTabs: (update) => {
				tabs = typeof update === "function" ? update(tabs) : update;
			},
		});
		return { original, tabs, refreshedEntry, handleSwitchTab };
	}

	it("remaps nested tabs, uses refreshed metadata, and preserves unsaved content and unrelated tabs", () => {
		const { original, tabs, refreshedEntry, handleSwitchTab } = remapTabs(
			"/vault/projects/sub/note.md",
		);
		expect(tabs).toEqual([
			{ entry: refreshedEntry, content: original[0].content },
			{
				entry: { ...original[1].entry, path: "/vault/work/sub/note.md" },
				content: original[1].content,
			},
			original[2],
		]);
		expect(tabs[0].entry).toBe(refreshedEntry);
		expect(tabs[2]).toBe(original[2]);
		expect(original[1].entry.path).toBe("/vault/projects/sub/note.md");
		expect(handleSwitchTab).toHaveBeenCalledExactlyOnceWith(
			"/vault/work/sub/note.md",
		);
	});

	it.each([
		null,
		"/vault/projects-archive/note.md",
		"/elsewhere/projects/note.md",
	])("keeps active tab %s unchanged", (activePath) => {
		const { handleSwitchTab } = remapTabs(activePath);
		expect(handleSwitchTab).not.toHaveBeenCalled();
	});
});

describe("folder rename sidebar synchronization", () => {
	function remapSelection(
		selection: SidebarSelection,
		refreshedEntries: VaultEntry[] = [],
	) {
		const setSelection = vi.fn();
		updateSelectionAfterFolderRename({
			vaultPath: "/vault",
			renameResult,
			selection,
			refreshedEntries,
			setSelection,
		});
		return setSelection;
	}

	it.each(["projects", "projects/sub"])("remaps selected folder %s", (path) => {
		expect(
			remapSelection({ kind: "folder", path }),
		).toHaveBeenCalledExactlyOnceWith({
			kind: "folder",
			path: path.replace("projects", "work"),
		});
	});

	it("selects the refreshed entity instead of stale metadata", () => {
		const refreshed = {
			...entry("/vault/work/sub/note.md"),
			title: "Refreshed title",
		};
		const setSelection = remapSelection(
			{ kind: "entity", entry: entry("/vault/projects/sub/note.md") },
			[refreshed],
		);
		expect(setSelection).toHaveBeenCalledExactlyOnceWith({
			kind: "entity",
			entry: refreshed,
		});
		expect(setSelection.mock.calls[0][0].entry).toBe(refreshed);
	});

	it("falls back to All Notes when the selected renamed entity is absent from the reload", () => {
		expect(
			remapSelection({
				kind: "entity",
				entry: entry("/vault/projects/note.md"),
			}),
		).toHaveBeenCalledExactlyOnceWith({ kind: "filter", filter: "all" });
	});

	it.each<SidebarSelection>([
		{ kind: "folder", path: "projects-archive" },
		{ kind: "entity", entry: entry("/vault/projects-archive/note.md") },
		{ kind: "filter", filter: "all" },
	])("leaves unrelated selection $kind unchanged", (selection) => {
		expect(remapSelection(selection)).not.toHaveBeenCalled();
	});
});

describe("useFolderRename", () => {
	beforeEach(() => {
		vi.mocked(mockInvoke).mockReset();
	});

	it("ends rename mode for an unchanged trimmed name without invoking or reloading", async () => {
		const { result, options } = setupRename();
		await act(async () => {
			expect(
				await result.current.renameFolder("parent/projects", "  projects  "),
			).toBe(true);
		});
		expect(result.current.renamingFolderPath).toBeNull();
		expect(mockInvoke).not.toHaveBeenCalled();
		expect(options.reloadFolders).not.toHaveBeenCalled();
		expect(options.reloadVault).not.toHaveBeenCalled();
		expect(options.setTabs).not.toHaveBeenCalled();
		expect(options.setSelection).not.toHaveBeenCalled();
		expect(options.handleSwitchTab).not.toHaveBeenCalled();
		expect(options.setToastMessage).not.toHaveBeenCalled();
	});

	it("reports invoke failure and preserves rename mode, tabs, active tab and selection", async () => {
		vi.mocked(mockInvoke).mockRejectedValue(new Error("Permission denied"));
		const { result, options, hold } = setupRename();
		await act(async () => {
			expect(await result.current.renameFolder("projects", "work")).toBe(false);
		});
		expect(hold.commit).not.toHaveBeenCalled();
		expect(hold.release).toHaveBeenCalledOnce();
		expect(result.current.renamingFolderPath).toBe("projects");
		expect(options.setToastMessage).toHaveBeenCalledExactlyOnceWith(
			"Failed to rename folder: Error: Permission denied",
		);
		expect(options.reloadFolders).not.toHaveBeenCalled();
		expect(options.reloadVault).not.toHaveBeenCalled();
		expect(options.setTabs).not.toHaveBeenCalled();
		expect(options.setSelection).not.toHaveBeenCalled();
		expect(options.handleSwitchTab).not.toHaveBeenCalled();
	});

	it("remaps tabs and lets the pages go before reloading, then remaps the selection", async () => {
		vi.mocked(mockInvoke).mockResolvedValue(renameResult);
		const { result, options, hold } = setupRename();
		await act(async () => {
			expect(await result.current.renameFolder("projects", "  work  ")).toBe(
				true,
			);
		});
		expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("rename_vault_folder", {
			vaultPath: "/vault",
			folderPath: "projects",
			newName: "work",
		});
		expect(result.current.renamingFolderPath).toBeNull();
		expect(hold.commit).toHaveBeenCalledExactlyOnceWith("/vault/work");
		expect(hold.release).toHaveBeenCalledOnce();
		expect(options.reloadFolders).toHaveBeenCalledTimes(1);
		expect(options.reloadVault).toHaveBeenCalledTimes(1);
		const order = [hold.commit, options.setTabs, hold.release, options.reloadFolders, options.reloadVault]
			.map((spy) => spy.mock.invocationCallOrder[0]);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		const updateTabs = options.setTabs.mock.calls[0][0];
		expect(updateTabs([tab("/vault/projects/sub/note.md")])).toEqual([
			tab("/vault/work/sub/note.md"),
		]);
		expect(options.handleSwitchTab).toHaveBeenCalledExactlyOnceWith(
			"/vault/work/sub/note.md",
		);
		expect(options.setSelection).toHaveBeenCalledExactlyOnceWith({
			kind: "folder",
			path: "work/sub",
		});
		expect(options.setToastMessage).toHaveBeenCalledExactlyOnceWith(
			'Renamed folder to "work"',
		);
	});
});
