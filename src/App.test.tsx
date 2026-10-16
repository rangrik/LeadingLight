import { act, render as testingLibraryRender, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_VAULTS } from './hooks/useVaultSwitcher'
import { invoke } from '@tauri-apps/api/core'
import type { Settings, ViewDefinition, ViewFile } from './types'
import type * as AppSaveModule from './hooks/useAppSave'
import type * as NoteActionsModule from './hooks/useNoteActions'
import type { NoteActionsConfig } from './hooks/useNoteActions'
import type { useNoteRetargetingUi } from './hooks/useNoteRetargetingUi'
import type { FolderMoveHold } from './hooks/folder-actions/folderActionUtils'

type RetargetingInput = Parameters<typeof useNoteRetargetingUi>[0]

// Provide a localStorage mock that supports all methods (jsdom's may be incomplete)
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock @tauri-apps/api/core before importing App
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/window')>('@tauri-apps/api/window')

  return {
    ...actual,
    getCurrentWindow: () => ({
      innerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1400, height: 900 }) })),
      scaleFactor: vi.fn(async () => 1),
      setMinSize: vi.fn(async () => {}),
      setSize: vi.fn(async () => {}),
    }),
  }
})

// Real local-only policy by default; dormant upstream flows opt in to keep their coverage.
const remotePolicy = vi.hoisted(() => ({ enabled: false }))
vi.mock('./leadinglight/localPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./leadinglight/localPolicy')>()
  return {
    ...actual,
    get REMOTE_FEATURES_ENABLED() { return remotePolicy.enabled },
    applyLocalOnlySettings: (settings: Settings) => (remotePolicy.enabled ? settings : actual.applyLocalOnlySettings(settings)),
  }
})

function enableUpstreamRemotePolicy() {
  remotePolicy.enabled = true
}

// Mock mock-tauri module
const mockEntries = [
  {
    path: '/vault/project/test.md',
    filename: 'test.md',
    title: 'Test Project',
    isA: 'Project',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    owner: 'Luca',
    cadence: null,
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 1024,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null, sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
  },
  {
    path: '/vault/topic/dev.md',
    filename: 'dev.md',
    title: 'Software Development',
    isA: 'Topic',
    aliases: ['Dev'],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    owner: null,
    cadence: null,
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 256,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null, sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
  },
]

const mockAllContent: Record<string, string> = {
  '/vault/project/test.md': '---\ntitle: Test Project\nis_a: Project\n---\n\n# Test Project\n\nSome content.',
  '/vault/topic/dev.md': '---\ntitle: Software Development\nis_a: Topic\n---\n\n# Software Development\n',
}

const mockVaultList = {
  vaults: [{ label: 'Test Vault', path: '/vault' }],
  active_vault: '/vault',
  hidden_defaults: [],
}

const mockDefaultVaultPath = '/Users/mock/Documents/Getting Started'
const expectedDefaultVaultPath = DEFAULT_VAULTS[0].path || mockDefaultVaultPath

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    auto_pull_interval_minutes: null,
    telemetry_consent: true,
    crash_reporting_enabled: null,
    analytics_enabled: null,
    anonymous_id: null,
    release_channel: null,
    ...overrides,
  }
}

const mockCommandResults: Record<string, unknown> = {
  load_vault_list: mockVaultList,
  list_vault: mockEntries,
  list_vault_folders: [],
  list_views: [],
  get_all_content: mockAllContent,
  get_modified_files: [],
  get_note_content: mockAllContent['/vault/project/test.md'] || '',
  save_note_content: null,
  reload_vault_entry: ({ path }: { path: string }) => mockEntries.find((entry) => entry.path === path) ?? null,
  sync_vault_asset_scope_for_window: null,
  get_file_history: [],
  get_settings: createSettings(),
  is_git_repo: true,
  init_git_repo: null,
  git_pull: { status: 'up_to_date', message: 'Already up to date', updatedFiles: [], conflictFiles: [] },
  save_settings: null,
  check_vault_exists: true,
  get_default_vault_path: expectedDefaultVaultPath,
  list_themes: [],
  get_vault_settings: { theme: null },
}

function buildNeighborhoodEntry({
  path,
  title,
  relatedRefs,
  outgoingLinks,
  modifiedAt,
}: {
  path: string
  title: string
  relatedRefs: string[]
  outgoingLinks: string[]
  modifiedAt: number
}) {
  return {
    path,
    filename: path.split('/').pop() ?? `${title.toLowerCase()}.md`,
    title,
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: relatedRefs,
    status: null,
    modifiedAt,
    createdAt: null,
    fileSize: 128,
    archived: false,
    snippet: '',
    wordCount: 12,
    relationships: relatedRefs.length > 0 ? { 'Related to': relatedRefs } : {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks,
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
  }
}

const neighborhoodEntries = [
  buildNeighborhoodEntry({
    path: '/vault/alpha.md',
    title: 'Alpha',
    relatedRefs: ['[[Beta]]'],
    outgoingLinks: ['Beta'],
    modifiedAt: 1700000003,
  }),
  buildNeighborhoodEntry({
    path: '/vault/beta.md',
    title: 'Beta',
    relatedRefs: ['[[Gamma]]'],
    outgoingLinks: ['Gamma'],
    modifiedAt: 1700000002,
  }),
  buildNeighborhoodEntry({
    path: '/vault/gamma.md',
    title: 'Gamma',
    relatedRefs: [],
    outgoingLinks: [],
    modifiedAt: 1700000001,
  }),
]

const neighborhoodContent: Record<string, string> = {
  '/vault/alpha.md': '# Alpha\n\n[[Beta]]',
  '/vault/beta.md': '# Beta\n\n[[Gamma]]',
  '/vault/gamma.md': '# Gamma',
}

function configureNeighborhoodVault() {
  mockCommandResults.list_vault = neighborhoodEntries
  mockCommandResults.get_all_content = neighborhoodContent
  mockCommandResults.get_note_content = ({ path }: { path: string }) => neighborhoodContent[path] ?? ''
}

// Inbox and organizing are opt-in; tests of that workflow turn it on for the vault.
function enableExplicitOrganization(vaultPath = '/vault') {
  localStorage.setItem(`laputa:vault-config:${vaultPath}`, JSON.stringify({
    zoom: null, view_mode: null, editor_mode: null, tag_colors: null, status_colors: null, property_display_modes: null,
    inbox: { noteListProperties: null, explicitOrganization: true },
  }))
}

function configureNeighborhoodFavoritesVault() {
  mockCommandResults.list_vault = neighborhoodEntries.map((entry) =>
    entry.path === '/vault/alpha.md'
      ? { ...entry, favorite: true, favoriteIndex: 0 }
      : entry,
  )
  mockCommandResults.get_all_content = neighborhoodContent
  mockCommandResults.get_note_content = ({ path }: { path: string }) => neighborhoodContent[path] ?? ''
}

function getHeaderForNoteList(noteListContainer: HTMLElement) {
  return within(noteListContainer.parentElement as HTMLElement).getByRole('heading', { level: 3 })
}

async function clickNoteListItem(noteListContainer: HTMLElement, title: string, options?: MouseEventInit) {
  await waitFor(() => {
    expect(within(noteListContainer).getByText(title)).toBeInTheDocument()
  })
  await act(async () => {
    fireEvent.click(within(noteListContainer).getByText(title), options)
    await Promise.resolve()
  })
}

async function enterNeighborhood(noteListContainer: HTMLElement, title: string) {
  await clickNoteListItem(noteListContainer, title, { metaKey: true })
}

async function pressEscape() {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Escape' })
    await Promise.resolve()
  })
}

function resetMockCommandResults() {
  Object.assign(mockCommandResults, {
    load_vault_list: mockVaultList,
    list_vault: mockEntries,
    list_vault_folders: [],
    list_views: [],
    get_all_content: mockAllContent,
    get_modified_files: [],
    get_note_content: mockAllContent['/vault/project/test.md'] || '',
    save_note_content: null,
    save_page_content: null,
    reload_vault_entry: ({ path }: { path: string }) => mockEntries.find((entry) => entry.path === path) ?? null,
    sync_vault_asset_scope_for_window: null,
    get_file_history: [],
    get_settings: createSettings({ auto_advance_inbox_after_organize: null }),
    is_git_repo: true,
    init_git_repo: null,
    save_settings: null,
    check_vault_exists: true,
    get_default_vault_path: expectedDefaultVaultPath,
    list_themes: [],
    get_vault_settings: { theme: null },
  })
}

function resolveMockCommandResult(cmd: string, args?: unknown) {
  const result = Reflect.get(mockCommandResults, cmd) as unknown
  return typeof result === 'function'
    ? (result as (input?: unknown) => unknown)(args)
    : result ?? null
}

vi.mock('./mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(async (cmd: string, args?: unknown) => resolveMockCommandResult(cmd, args)),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
}))

// Mock ai-chat utilities
vi.mock('./utils/ai-chat', async () => {
  const actual = await vi.importActual<typeof import('./utils/ai-chat')>('./utils/ai-chat')

  return {
    ...actual,
    buildSystemPrompt: vi.fn(() => ({ prompt: '', totalTokens: 0, truncated: false })),
    checkClaudeCli: vi.fn(async () => ({ installed: false })),
    streamClaudeChat: vi.fn(async () => 'mock-session'),
  }
})

vi.mock('./utils/streamAiAgent', () => ({
  streamAiAgent: vi.fn(async () => {}),
}))

vi.mock('./hooks/useUpdater', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useUpdater')>('./hooks/useUpdater')

  return {
    ...actual,
    useUpdater: vi.fn(() => ({
      status: { state: 'idle' },
      actions: {
        checkForUpdates: vi.fn(async () => ({ kind: 'up-to-date' })),
        startDownload: vi.fn(),
        openReleaseNotes: vi.fn(),
        dismiss: vi.fn(),
      },
    })),
    restartApp: vi.fn(),
  }
})

// Mock BlockNote components (they need DOM APIs not available in jsdom)
vi.mock('@blocknote/core', () => ({
  audioParse: vi.fn(() => undefined), createAudioBlockConfig: vi.fn(() => ({})),
  BlockNoteSchema: { create: () => ({ extend: () => ({}) }) },
  createCodeBlockSpec: vi.fn(() => ({})),
  createExtension: (factory: unknown) => () => factory,
  createStyleSpec: vi.fn(() => ({})),
  createVideoBlockConfig: vi.fn(() => ({})), defaultInlineContentSpecs: {},
  filterSuggestionItems: vi.fn(() => []), videoParse: vi.fn(() => undefined),
}))

vi.mock('@blocknote/code-block', () => ({ codeBlockOptions: {} }))

vi.mock('@blocknote/core/extensions', () => ({ filterSuggestionItems: vi.fn(() => []) }))

vi.mock('@blocknote/react', () => {
  const blockNoteEditor = {
    tryParseMarkdownToBlocks: async () => [],
    replaceBlocks: () => {},
    document: [],
    insertInlineContent: () => {},
    setTextCursorPosition: () => {},
    focus: () => {},
    domElement: null,
    onChange: () => () => {},
    onMount: (cb: () => void) => { cb(); return () => {} },
  }

  return {
    AudioBlock: () => null, AudioToExternalHTML: () => null,
    createReactBlockSpec: () => () => ({}),
    createReactInlineContentSpec: () => ({ render: () => null }),
    VideoBlock: () => null, VideoToExternalHTML: () => null,
    BlockNoteViewRaw: ({ children, editable }: { children?: ReactNode; editable?: boolean }) => (
      <div data-testid="blocknote-view" data-editable={editable !== false ? 'true' : 'false'}>
        <div contentEditable={editable !== false} suppressContentEditableWarning data-testid="mock-editor">
          mock editor
        </div>
        {children}
      </div>
    ),
    LinkToolbar: ({ children }: { children?: ReactNode }) => <>{children}</>,
    ComponentsContext: {
      Provider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    },
    useCreateBlockNote: () => blockNoteEditor,
    useBlockNoteEditor: () => blockNoteEditor,
    LinkToolbarController: () => null,
    EditLinkButton: () => null,
    DeleteLinkButton: () => null,
    SideMenuController: () => null,
    SuggestionMenuController: () => null,
    GridSuggestionMenuController: () => null,
    useComponentsContext: () => ({
      LinkToolbar: {
        Button: ({
          children,
          label,
          onClick,
        }: { children?: ReactNode; label?: string; onClick?: () => void }) => (
          <button onClick={onClick} type="button">
            {label}
            {children}
          </button>
        ),
      },
    }),
    useDictionary: () => ({
      link_toolbar: {
        open: { tooltip: 'Open in a new tab' },
      },
    }),
  }
})

vi.mock('@blocknote/mantine', () => ({
  components: {},
  BlockNoteView: ({ children }: { children?: React.ReactNode }) => <div data-testid="blocknote-view">{children}</div>,
}))

vi.mock('@blocknote/mantine/style.css', () => ({}))

vi.mock('./components/tolariaEditorFormatting', () => ({
  TolariaFormattingToolbar: () => null,
  TolariaFormattingToolbarController: () => null,
}))

// The real hooks, recording what App hands them, so the page barriers are tested as App wires them.
const appWiring = vi.hoisted(() => ({
  noteActions: null as NoteActionsConfig | null,
  notes: null as ReturnType<typeof NoteActionsModule.useNoteActions> | null,
  appSave: null as ReturnType<typeof AppSaveModule.useAppSave> | null,
  prepareFolderMove: null as ((folderPath: string) => Promise<FolderMoveHold>) | null,
  moveNoteToFolder: null as RetargetingInput['moveNoteToFolder'] | null,
  closeFlush: null as (() => Promise<void>) | null,
  switchVault: null as (() => void | Promise<void>) | null,
}))
vi.mock('./hooks/useNoteActions', async (importOriginal) => {
  const actual = await importOriginal<typeof NoteActionsModule>()
  return { ...actual, useNoteActions: (config: NoteActionsConfig) => { appWiring.noteActions = config; return (appWiring.notes = actual.useNoteActions(config)) } }
})
vi.mock('./hooks/useNoteRetargetingUi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useNoteRetargetingUi')>()
  return { ...actual, useNoteRetargetingUi: (input: RetargetingInput) => { appWiring.moveNoteToFolder = input.moveNoteToFolder; return actual.useNoteRetargetingUi(input) } }
})
vi.mock('./leadinglight/useNativeSaveBeforeClose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./leadinglight/useNativeSaveBeforeClose')>()
  return {
    ...actual,
    useNativeSaveBeforeClose: (options: Parameters<typeof actual.useNativeSaveBeforeClose>[0]) => {
      appWiring.closeFlush = options.flush
      return actual.useNativeSaveBeforeClose(options)
    },
  }
})
vi.mock('./hooks/useVaultSwitcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useVaultSwitcher')>()
  return {
    ...actual,
    useVaultSwitcher: (options: Parameters<typeof actual.useVaultSwitcher>[0]) => {
      appWiring.switchVault = options.onSwitch
      return actual.useVaultSwitcher(options)
    },
  }
})
vi.mock('./hooks/useAppSave', async (importOriginal) => {
  const actual = await importOriginal<typeof AppSaveModule>()
  return { ...actual, useAppSave: (options: Parameters<typeof actual.useAppSave>[0]) => (appWiring.appSave = actual.useAppSave(options)) }
})
vi.mock('./hooks/useFolderActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useFolderActions')>()
  return {
    ...actual,
    useFolderActions: (input: Parameters<typeof actual.useFolderActions>[0]) => {
      appWiring.prepareFolderMove = input.prepareFolderMove
      return actual.useFolderActions(input)
    },
  }
})

import App from './App'
import { TooltipProvider } from './components/ui/tooltip'
import { useUpdater } from './hooks/useUpdater'
import { isTauri } from './mock-tauri'
import { streamAiAgent } from './utils/streamAiAgent'

const AI_AGENTS_ONBOARDING_DISMISSED_STORAGE_NAME = 'tolaria:ai-agents-onboarding-dismissed'
const CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME = 'tolaria:claude-code-onboarding-dismissed'
const SLOW_APP_READY_TIMEOUT_MS = 10_000

function render(ui: ReactElement, options?: Parameters<typeof testingLibraryRender>[1]) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
    ...options,
  })
}

function rememberDefaultVaultWithoutOnboarding() {
  localStorage.setItem('tolaria_welcome_dismissed', '1')
  mockCommandResults.get_default_vault_path = expectedDefaultVaultPath
  mockCommandResults.get_settings = createSettings({ telemetry_consent: null })
  mockCommandResults.load_vault_list = {
    vaults: [],
    active_vault: expectedDefaultVaultPath,
    hidden_defaults: [],
  }
  mockCommandResults.check_vault_exists = (args?: { path?: string }) => args?.path === expectedDefaultVaultPath
}

async function openFolderOnFirstRun(
  label: string,
  { action = 'welcome-open-folder', exists = () => true }: { action?: string; exists?: () => boolean } = {},
) {
  const folderPath = `/Users/mock/Documents/${label}`
  const saveVaultList = vi.fn()
  const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(`file://${encodeURI(folderPath)}`)
  localStorage.removeItem(CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME)
  mockCommandResults.load_vault_list = { vaults: [], active_vault: null, hidden_defaults: [] }
  mockCommandResults.check_vault_exists = (args?: { path?: string }) => args?.path === folderPath && exists()
  mockCommandResults.save_vault_list = (args?: unknown) => {
    saveVaultList(args)
    return null
  }

  render(<App />)
  fireEvent.click(await screen.findByTestId(action, {}, { timeout: SLOW_APP_READY_TIMEOUT_MS }))

  await waitFor(() => {
    expect(saveVaultList).toHaveBeenCalledWith({
      list: {
        vaults: [{ label, path: folderPath, alias: null, color: null, icon: null, mounted: true }],
        active_vault: folderPath,
        default_workspace_path: folderPath,
        hidden_defaults: [],
      },
    })
  })
  expect(saveVaultList).toHaveBeenCalledTimes(1)
  return promptSpy
}

function createMockUpdaterResult(
  checkForUpdates: () => Promise<{ kind: 'up-to-date' } | { kind: 'available'; version: string; displayVersion: string } | { kind: 'error'; message: string }> = async () => ({ kind: 'up-to-date' }),
) {
  return {
    status: { state: 'idle' as const },
    actions: {
      checkForUpdates,
      startDownload: vi.fn(),
      openReleaseNotes: vi.fn(),
      dismiss: vi.fn(),
    },
  }
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    remotePolicy.enabled = false
    resetMockCommandResults()
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => resolveMockCommandResult(cmd, args))
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(useUpdater).mockReturnValue(createMockUpdaterResult())
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    localStorage.setItem(CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME, '1')
  })

  it('renders the four-panel layout', async () => {
    render(<App />)
    expect(await screen.findByText('All Notes', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('creates custom views with a portable fallback filename for symbol-only names', async () => {
    const savedViews: ViewFile[] = []
    const saveView = vi.fn(({ filename, definition }: { filename: string; definition: ViewDefinition }) => {
      if (filename === '.yml') throw new Error('Invalid view filename')
      savedViews.push({ filename, definition })
      return null
    })
    mockCommandResults.save_view_cmd = saveView
    mockCommandResults.list_views = () => savedViews
    mockCommandResults.reload_vault = mockEntries

    render(<App />)

    await screen.findByText('All Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Create view' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText(/Active Projects|Reading List/i), {
      target: { value: '🚀' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(saveView).toHaveBeenCalledWith(expect.objectContaining({
        filename: 'view.yml',
        definition: expect.objectContaining({ name: '🚀' }),
      }))
    })
  }, 10000)

  it('loads and displays vault entries in sidebar', async () => {
    render(<App />)
    await waitFor(() => {
      // Entries appear in both Sidebar and NoteList
      expect(screen.getAllByText('Test Project').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Software Development').length).toBeGreaterThan(0)
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })
  })

  it('keeps one startup shell visible while the initial vault note scan is pending', async () => {
    let resolveListVault: ((value: typeof mockEntries) => void) | null = null
    const listVaultPromise = new Promise<typeof mockEntries>((resolve) => {
      resolveListVault = resolve
    })
    mockCommandResults.list_vault = () => listVaultPromise

    render(<App />)

    expect(await screen.findByTestId('startup-shell-fallback', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-loading-favorites')).not.toBeInTheDocument()
    expect(screen.queryByTestId('note-list-loading-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-vault-reloading')).not.toBeInTheDocument()

    await act(async () => {
      resolveListVault?.(mockEntries)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByTestId('startup-shell-fallback')).not.toBeInTheDocument()
      expect(screen.queryByTestId('note-list-loading-skeleton')).not.toBeInTheDocument()
      expect(screen.getAllByText('Test Project').length).toBeGreaterThan(0)
    })
  })

  it('shows the empty page state when no note is selected', async () => {
    render(<App />)
    expect(await screen.findByText('Open a page here', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })).toBeInTheDocument()
  })

  it('opens a note window after loading the active vault graph', async () => {
    const listVault = vi.fn(() => mockEntries)
    const reloadVaultEntry = vi.fn(({ path }: { path: string }) =>
      mockEntries.find((entry) => entry.path === path) ?? null,
    )
    const getNoteContent = vi.fn(({ path }: { path: string }) => mockAllContent[path] ?? '')
    mockCommandResults.list_vault = listVault
    mockCommandResults.reload_vault_entry = reloadVaultEntry
    mockCommandResults.get_note_content = getNoteContent
    window.history.replaceState(
      {},
      '',
      '/?window=note&path=%2Fvault%2Fproject%2Ftest.md&vault=%2Fvault&title=Test+Project',
    )

    render(<App />)

    await waitFor(() => expect(reloadVaultEntry).toHaveBeenCalled())
    expect(reloadVaultEntry).toHaveBeenCalledWith({ path: '/vault/project/test.md', vaultPath: '/vault' })
    await waitFor(() => expect(getNoteContent).toHaveBeenCalled())
    expect(getNoteContent).toHaveBeenCalledWith({ path: '/vault/project/test.md', vaultPath: '/vault' })
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/project/test.md'))
    expect(await screen.findByTestId('blocknote-view', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })).toHaveAttribute('data-editable', 'true')
    expect(listVault).toHaveBeenCalled()
  }, SLOW_APP_READY_TIMEOUT_MS * 2)

  it('creates a local page from the empty page state', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const saveNoteContent = vi.fn(() => null)
    mockCommandResults.save_note_content = saveNoteContent

    try {
      render(<App />)
      const pane = await screen.findByLabelText('Page pane 1', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
      fireEvent.click(within(pane).getByText('New page'))

      // An ordinary page: empty and untyped until the person writes.
      await waitFor(() => {
        expect(saveNoteContent).toHaveBeenCalledWith(expect.objectContaining({
          path: '/vault/untitled-page-1700000000.md',
          content: '',
          vaultPath: '/vault',
        }))
      })
      await waitFor(() => {
        expect(window.__laputaTest?.activeTabPath).toBe('/vault/untitled-page-1700000000.md')
      })
    } finally {
      dateNow.mockRestore()
    }
  })

  it('registers keyboard shortcuts without error', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })

    // Cmd+S with no pending changes shows "Nothing to save"
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await waitFor(() => {
      expect(screen.getByText('Nothing to save')).toBeInTheDocument()
    })
  })

  it('persists a Cmd+N note before opening it in the editor', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    let resolveSave!: () => void
    const saveNoteContent = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    mockCommandResults.save_note_content = saveNoteContent

    try {
      render(<App />)
      await screen.findByText('All Notes')

      fireEvent.keyDown(window, { key: 'n', code: 'KeyN', metaKey: true })

      // Cmd+N is an ordinary New page: empty, untyped, and named "Untitled" until it has a body.
      await waitFor(() => {
        expect(saveNoteContent).toHaveBeenCalledWith({
          path: '/vault/untitled-page-1700000000.md',
          content: '',
          vaultPath: '/vault',
        })
      })
      expect(window.__laputaTest?.activeTabPath).not.toBe('/vault/untitled-page-1700000000.md')

      await act(async () => {
        resolveSave()
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(window.__laputaTest?.activeTabPath).toBe('/vault/untitled-page-1700000000.md')
      })
      expect(screen.getAllByText('Untitled').length).toBeGreaterThan(0)
    } finally {
      dateNow.mockRestore()
    }
  })

  // Seam: keys typed before the new page exists stay in a visible field, and Save never claims them saved.
  it('holds early typing in a draft field through a failed create, and Save says it is not in a page yet', async () => {
    let refuseSave!: (error: Error) => void
    const saveNoteContent = vi.fn(() => new Promise<void>((_resolve, reject) => { refuseSave = reject }))
    mockCommandResults.save_note_content = saveNoteContent
    render(<App />)
    await screen.findByText('All Notes')
    // An ordinary page stays open, so Save also waits for a repository refresh before it returns.
    fireEvent.click(within(await screen.findByTestId('note-list-container')).getByText('Test Project'))
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/project/test.md'))

    fireEvent.keyDown(window, { key: 'n', code: 'KeyN', metaKey: true })
    const draft = screen.getByRole('textbox', { name: 'Your draft' })
    expect(document.activeElement).toBe(draft)
    expect(screen.getByText('Opening page…')).toBeInTheDocument()
    fireEvent.change(draft, { target: { value: 'Harbor fog\nat dawn' } })

    await waitFor(() => expect(saveNoteContent).toHaveBeenCalled())
    await act(async () => { refuseSave(new Error('The disk refused the write.')) })
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your draft' })).toHaveValue('Harbor fog\nat dawn')
    expect(window.__laputaTest?.activeTabPath ?? '').not.toMatch(/untitled-page/)

    let releaseRefresh: () => void = () => {}
    mockCommandResults.get_modified_files = () => new Promise(resolve => { releaseRefresh = () => resolve([]) })
    // Save must never flash Saved or Nothing to save while the draft is still outside any page.
    const flashed: string[] = []
    const watch = new MutationObserver(() => {
      for (const text of ['Saved', 'Nothing to save']) {
        // The open page's own status label is not a Save announcement.
        if (screen.queryAllByText(text, { exact: true }).some(element => !element.closest('section[data-pane-id]'))) flashed.push(text)
      }
    })
    watch.observe(document.body, { childList: true, subtree: true, characterData: true })
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    releaseRefresh()
    expect(await screen.findByText('Your draft isn’t in a page yet. It is still on screen.')).toBeInTheDocument()
    watch.disconnect()
    expect(flashed).toEqual([])
    expect(screen.getByRole('textbox', { name: 'Your draft' })).toHaveValue('Harbor fog\nat dawn')
  })

  it('shows visible feedback when a manual update check finds an update', async () => {
    enableUpstreamRemotePolicy()
    vi.mocked(useUpdater).mockReturnValue(createMockUpdaterResult(async () => ({
      kind: 'available',
      version: '2026.4.25',
      displayVersion: '2026.4.25',
    })))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('status-build-number'))

    await waitFor(() => {
      expect(screen.getByText('Tolaria 2026.4.25 is available')).toBeInTheDocument()
    })
  })

  it('shows visible feedback when a menu-driven update check finds no eligible update', async () => {
    enableUpstreamRemotePolicy()
    vi.mocked(useUpdater).mockReturnValue(createMockUpdaterResult(async () => ({ kind: 'up-to-date' })))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
      expect(typeof window.__laputaTest?.dispatchBrowserMenuCommand).toBe('function')
    })

    act(() => {
      window.__laputaTest?.dispatchBrowserMenuCommand?.('app-check-for-updates')
    })

    await waitFor(() => {
      expect(screen.getByText('No newer stable update is available right now')).toBeInTheDocument()
    })
  })

  it('shows immediate feedback while a menu-driven update check is pending', async () => {
    enableUpstreamRemotePolicy()
    let resolveUpdate: ((result: { kind: 'up-to-date' }) => void) | null = null
    const checkForUpdates = vi.fn(() => new Promise<{ kind: 'up-to-date' }>((resolve) => {
      resolveUpdate = resolve
    }))
    vi.mocked(useUpdater).mockReturnValue(createMockUpdaterResult(checkForUpdates))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
      expect(typeof window.__laputaTest?.dispatchBrowserMenuCommand).toBe('function')
    })

    act(() => {
      window.__laputaTest?.dispatchBrowserMenuCommand?.('app-check-for-updates')
    })

    await waitFor(() => {
      expect(screen.getByText('Checking for updates...')).toBeInTheDocument()
    })
    expect(checkForUpdates).toHaveBeenCalledOnce()

    await act(async () => {
      resolveUpdate?.({ kind: 'up-to-date' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('No newer stable update is available right now')).toBeInTheDocument()
    })
  })

  it('shows the external AI setup dialog from the menu when AI onboarding is active', async () => {
    enableUpstreamRemotePolicy()
    localStorage.removeItem(AI_AGENTS_ONBOARDING_DISMISSED_STORAGE_NAME)
    localStorage.removeItem(CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME)
    mockCommandResults.get_ai_agents_status = {
      claude_code: { installed: true, version: '2.1.90' },
      codex: { installed: true, version: '0.122.0-alpha.1' },
      opencode: { installed: false, version: null },
      pi: { installed: false, version: null },
      antigravity: { installed: false, version: null },
    }
    mockCommandResults.check_mcp_status = 'installed'

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('AI is ready')).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })

    await waitFor(() => {
      expect(typeof window.__laputaTest?.dispatchBrowserMenuCommand).toBe('function')
    })

    act(() => {
      window.__laputaTest?.dispatchBrowserMenuCommand?.('vault-install-mcp')
    })

    await waitFor(() => {
      expect(screen.getByText('Manage External AI Tools')).toBeInTheDocument()
    })
    expect(screen.getByTestId('mcp-setup-dialog')).toBeInTheDocument()
    expect(screen.queryByText('AI is ready')).not.toBeInTheDocument()
  })

  it('routes right-panel AI chat messages to the selected default agent', async () => {
    enableUpstreamRemotePolicy()
    mockCommandResults.get_settings = createSettings({
      auto_advance_inbox_after_organize: null,
      default_ai_agent: 'codex',
    })
    mockCommandResults.get_ai_agents_status = {
      claude_code: { installed: true, version: '2.1.90' },
      codex: { installed: true, version: '0.122.0-alpha.1' },
      opencode: { installed: false, version: null },
      pi: { installed: false, version: null },
      antigravity: { installed: false, version: null },
    }

    render(<App />)

    await screen.findByText('All Notes')
    // AI chat lives in the open page's editor pane.
    await clickNoteListItem(screen.getByTestId('note-list-container'), 'Test Project')
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL', metaKey: true, shiftKey: true })

    const input = await screen.findByTestId('agent-input')
    await waitFor(() => {
      expect(input).toHaveAttribute('aria-placeholder', 'Ask Codex')
    })

    input.textContent = 'Summarize the active vault'
    fireEvent.input(input)
    fireEvent.click(screen.getByTestId('agent-send'))

    await waitFor(() => {
      expect(streamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'codex',
      }))
    })
  })

  it('waits for saved AI agent settings before sending right-panel messages', async () => {
    enableUpstreamRemotePolicy()
    let resolveSettings: ((settings: Settings) => void) | null = null
    mockCommandResults.get_settings = () => new Promise((resolve) => {
      resolveSettings = resolve
    })
    mockCommandResults.get_ai_agents_status = {
      claude_code: { installed: true, version: '2.1.90' },
      codex: { installed: true, version: '0.122.0-alpha.1' },
      opencode: { installed: false, version: null },
      pi: { installed: false, version: null },
      antigravity: { installed: false, version: null },
    }

    render(<App />)

    await screen.findByText('All Notes')
    // AI chat lives in the open page's editor pane.
    await clickNoteListItem(screen.getByTestId('note-list-container'), 'Test Project')
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL', metaKey: true, shiftKey: true })

    const input = await screen.findByTestId('agent-input')
    fireEvent.click(screen.getByTestId('agent-send'))

    await act(async () => {
      await Promise.resolve()
    })
    expect(streamAiAgent).not.toHaveBeenCalled()

    await act(async () => {
      resolveSettings?.(createSettings({
        auto_advance_inbox_after_organize: null,
        default_ai_agent: 'codex',
      }))
    })

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-placeholder', 'Ask Codex')
    })

    input.textContent = 'Summarize the active vault'
    fireEvent.input(input)
    fireEvent.click(screen.getByTestId('agent-send'))

    await waitFor(() => {
      expect(streamAiAgent).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'codex',
      }))
    })
  })

  it('shows onboarding after telemetry consent when no active vault is configured', async () => {
    enableUpstreamRemotePolicy()
    mockCommandResults.get_settings = createSettings({ telemetry_consent: null })
    mockCommandResults.load_vault_list = { vaults: [], active_vault: null, hidden_defaults: [] }
    mockCommandResults.check_vault_exists = (args?: { path?: string }) => args?.path === expectedDefaultVaultPath

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Help improve Tolaria')).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })

    fireEvent.click(screen.getByTestId('telemetry-accept'))

    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open a folder')
  })

  it.each([
    ['telemetry-accept', 'Allow anonymous reporting'],
    ['telemetry-decline', 'No thanks'],
  ])('ignores a remembered default vault after %s when onboarding was never completed', async (buttonTestId) => {
    enableUpstreamRemotePolicy()
    rememberDefaultVaultWithoutOnboarding()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Help improve Tolaria')).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })

    fireEvent.click(screen.getByTestId(buttonTestId))

    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open a folder')
  })

  it('starts unfinished onboarding at the local welcome without telemetry or AI prompts', async () => {
    rememberDefaultVaultWithoutOnboarding()

    render(<App />)

    expect(await screen.findByTestId('welcome-screen', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })).toBeInTheDocument()
    expect(screen.getByTestId('welcome-create-new')).toHaveTextContent('Create local workspace')
    expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open a folder')
    expect(screen.queryByTestId('telemetry-accept')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-agents-onboarding-screen')).not.toBeInTheDocument()
  })

  it('keeps one startup shell visible while the last vault is still resolving', async () => {
    localStorage.setItem('tolaria_welcome_dismissed', '1')

    let resolveVaultList: ((value: typeof mockVaultList) => void) | null = null

    mockCommandResults.load_vault_list = () =>
      new Promise<typeof mockVaultList>((resolve) => {
        resolveVaultList = resolve
      })
    mockCommandResults.check_vault_exists = (args?: { path?: string }) => args?.path === '/work'

    render(<App />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('startup-shell-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('note-list-loading-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-vault-reloading')).not.toBeInTheDocument()

    await act(async () => {
      resolveVaultList?.({
        vaults: [{ label: 'Work Vault', path: '/work' }],
        active_vault: '/work',
        hidden_defaults: [],
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByTestId('startup-shell-fallback')).not.toBeInTheDocument()
      expect(screen.getByTestId('status-vault-trigger')).toHaveTextContent('Work Vault')
    })
  })

  it('shows the missing-vault screen once the resolved active vault is confirmed missing', async () => {
    localStorage.setItem('tolaria_welcome_dismissed', '1')
    mockCommandResults.load_vault_list = {
      vaults: [{ label: 'Old Vault', path: '/missing-vault' }],
      active_vault: '/missing-vault',
      hidden_defaults: [],
    }
    mockCommandResults.check_vault_exists = (args?: { path?: string }) => args?.path === expectedDefaultVaultPath

    render(<App />)

    expect(await screen.findByText('Workspace folder not found', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })).toBeInTheDocument()
    expect(screen.getByText('/missing-vault')).toBeInTheDocument()
    expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open a folder')
  })

  it('shows welcome instead of vault-missing when the missing path was not a persisted active vault', async () => {
    localStorage.setItem('tolaria_welcome_dismissed', '1')
    mockCommandResults.load_vault_list = {
      vaults: [],
      active_vault: null,
      hidden_defaults: [],
    }
    mockCommandResults.check_vault_exists = (args?: { path?: string }) => args?.path === expectedDefaultVaultPath

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'LeadingLight' })).toBeInTheDocument()
    expect(screen.queryByText('Workspace folder not found')).not.toBeInTheDocument()
    expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open a folder')
  })

  it('persists an existing folder after first-run open without AI onboarding', async () => {
    const getAiAgentsStatus = vi.fn(() => ({}))
    mockCommandResults.get_ai_agents_status = getAiAgentsStatus
    const promptSpy = await openFolderOnFirstRun('Work Vault')

    await waitFor(() => {
      expect(screen.getByTestId('status-vault-trigger')).toHaveTextContent('Work Vault')
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    expect(screen.queryByTestId('ai-agents-onboarding-screen')).not.toBeInTheDocument()
    expect(getAiAgentsStatus).not.toHaveBeenCalled()

    promptSpy.mockRestore()
  })

  it('persists an existing vault and shows AI onboarding after first-run open', async () => {
    enableUpstreamRemotePolicy()
    mockCommandResults.get_ai_agents_status = {}
    const promptSpy = await openFolderOnFirstRun('Work Vault')

    await waitFor(() => {
      expect(screen.getByTestId('ai-agents-onboarding-screen')).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    expect(screen.getByText('AI setup is optional')).toBeInTheDocument()

    promptSpy.mockRestore()
  })

  it('creates and opens a local workspace folder on first run', async () => {
    let created = false
    const createEmptyVault = vi.fn(() => {
      created = true
      return '/Users/mock/Documents/LeadingLight Vault'
    })
    mockCommandResults.create_empty_vault = createEmptyVault
    const promptSpy = await openFolderOnFirstRun('LeadingLight Vault', {
      action: 'welcome-create-new',
      exists: () => created,
    })

    expect(createEmptyVault).toHaveBeenCalledWith({ targetPath: '/Users/mock/Documents/LeadingLight Vault' })
    await waitFor(() => {
      expect(screen.getByTestId('status-vault-trigger')).toHaveTextContent('LeadingLight Vault')
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })

    promptSpy.mockRestore()
  })

  it('renders sidebar with correct default selection (All Notes)', async () => {
    render(<App />)
    await waitFor(() => {
      // "All Notes" should be rendered as the selected nav item
      expect(screen.getByText('All Notes')).toBeInTheDocument()
      expect(screen.getByText('Archive')).toBeInTheDocument()
    })
  })

  it('finds recently opened pages from one dialog, by shortcut or sidebar, across a restart', async () => {
    configureNeighborhoodVault()
    const first = render(<App />)
    const noteList = await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    await clickNoteListItem(noteList, 'Alpha')
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md'))
    await clickNoteListItem(noteList, 'Beta')
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/beta.md'))
    await clickNoteListItem(noteList, 'Alpha')
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md'))

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Find a page' })
    // Full-text search is the same finder, not a second dialog.
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true, shiftKey: true })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    // True visit order, the open page first; Gamma was never opened.
    expect(within(dialog).getAllByRole('option').map(option => option.textContent)).toEqual(['Alpha', 'Beta'])

    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/beta.md'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    first.unmount()

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }, { timeout: SLOW_APP_READY_TIMEOUT_MS }))
    const reopened = await screen.findByRole('dialog', { name: 'Find a page' })
    await waitFor(() => expect(within(reopened).getAllByRole('option').map(option => option.textContent)).toEqual(['Beta', 'Alpha']))
  }, SLOW_APP_READY_TIMEOUT_MS * 3)

  it('creates and opens a page from the finder query', async () => {
    configureNeighborhoodVault()
    render(<App />)
    await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Find a page' })
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Delta plan' } })
    expect(within(dialog).getByRole('option', { name: 'Create page “Delta plan”' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toMatch(/\/vault\/delta-plan\.md$/))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }, SLOW_APP_READY_TIMEOUT_MS * 2)

  it('keeps the current page and the finder open when the chosen page cannot be read', async () => {
    configureNeighborhoodVault()
    mockCommandResults.get_note_content = ({ path }: { path: string }) => {
      if (path === '/vault/gamma.md') throw new Error('stream did not contain valid UTF-8')
      return neighborhoodContent[path] ?? ''
    }
    render(<App />)
    const noteList = await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    await clickNoteListItem(noteList, 'Alpha')
    await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md'))

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Find a page' })
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Gamma' } })
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' })
    expect(await within(dialog).findByText('Couldn’t open “Gamma”.')).toBeInTheDocument()
    expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md')
  }, SLOW_APP_READY_TIMEOUT_MS * 2)

  it('pressing Escape in Neighborhood mode blurs the editor before unwinding note-list history', async () => {
    configureNeighborhoodVault()

    render(<App />)

    const noteListContainer = await screen.findByTestId('note-list-container', {}, { timeout: 5000 })
    const getHeader = () => getHeaderForNoteList(noteListContainer)

    await waitFor(() => {
      expect(getHeader()).toHaveTextContent('Notes')
    })

    await enterNeighborhood(noteListContainer, 'Alpha')

    await waitFor(() => {
      expect(getHeader()).toHaveTextContent('Alpha')
    })

    const editor = screen.getByTestId('mock-editor')
    editor.focus()
    expect(editor).toHaveFocus()

    await pressEscape()

    await waitFor(() => {
      expect(noteListContainer).toHaveFocus()
      expect(getHeader()).toHaveTextContent('Alpha')
    })

    await enterNeighborhood(noteListContainer, 'Beta')

    await waitFor(() => {
      expect(getHeader()).toHaveTextContent('Beta')
    })

    await pressEscape()

    await waitFor(() => {
      expect(getHeader()).toHaveTextContent('Alpha')
    })

    await pressEscape()

    await waitFor(() => {
      expect(getHeader()).toHaveTextContent('Notes')
    })
  }, 10_000)

  describe('opening a favorite', () => {
    const favoriteRow = async (title: string) => {
      const header = await screen.findByText('FAVORITES', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
      const section = header.closest('div')?.parentElement as HTMLElement
      return within(section).findByText(title)
    }
    const readsOf = (reads: ReturnType<typeof vi.fn>, path: string) =>
      reads.mock.calls.filter(([args]) => (args as { path: string }).path === path).length

    // Seam: a favorite click used to switch the list into a neighborhood and reload the open page.
    it('opens the exact page and leaves the list and its filter alone, even when clicked twice', async () => {
      configureNeighborhoodFavoritesVault()
      const reads = vi.fn(({ path }: { path: string }) => neighborhoodContent[path] ?? '')
      mockCommandResults.get_note_content = reads
      render(<App />)
      const noteList = await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
      await enterNeighborhood(noteList, 'Beta')
      await waitFor(() => expect(getHeaderForNoteList(noteList)).toHaveTextContent('Beta'))

      fireEvent.click(await favoriteRow('Alpha'))
      await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md'))
      const alphaReads = readsOf(reads, '/vault/alpha.md')
      fireEvent.click(await favoriteRow('Alpha'))
      await act(async () => { await Promise.resolve() })

      expect(getHeaderForNoteList(noteList)).toHaveTextContent('Beta')
      expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md')
      expect(readsOf(reads, '/vault/alpha.md')).toBe(alphaReads)
    }, SLOW_APP_READY_TIMEOUT_MS * 2)

    it('keeps the current page when the favorite cannot be read', async () => {
      configureNeighborhoodFavoritesVault()
      mockCommandResults.get_note_content = ({ path }: { path: string }) => {
        if (path === '/vault/alpha.md') throw new Error('stream did not contain valid UTF-8')
        return neighborhoodContent[path] ?? ''
      }
      render(<App />)
      const noteList = await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
      await clickNoteListItem(noteList, 'Beta')
      await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/beta.md'))

      fireEvent.click(await favoriteRow('Alpha'))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })

      expect(window.__laputaTest?.activeTabPath).toBe('/vault/beta.md')
    }, SLOW_APP_READY_TIMEOUT_MS * 2)

    it('does not pull focus into the page if the person moved on during a slow read', async () => {
      configureNeighborhoodFavoritesVault()
      let finishRead: (content: string) => void = () => {}
      mockCommandResults.get_note_content = ({ path }: { path: string }) => path === '/vault/alpha.md'
        ? new Promise<string>(resolve => { finishRead = resolve })
        : neighborhoodContent[path] ?? ''
      const focusRequests: string[] = []
      const onFocusRequest = (event: Event) => { focusRequests.push((event as CustomEvent<{ path: string }>).detail.path) }
      window.addEventListener('laputa:focus-editor', onFocusRequest)
      const field = document.body.appendChild(document.createElement('input'))
      try {
        render(<App />)
        fireEvent.click(await favoriteRow('Alpha'))
        field.focus()
        await act(async () => { finishRead(neighborhoodContent['/vault/alpha.md']) })
        await waitFor(() => expect(window.__laputaTest?.activeTabPath).toBe('/vault/alpha.md'))

        expect(document.activeElement).toBe(field)
        expect(focusRequests).not.toContain('/vault/alpha.md')
      } finally {
        window.removeEventListener('laputa:focus-editor', onFocusRequest)
        field.remove()
      }
    }, SLOW_APP_READY_TIMEOUT_MS * 2)
  })

  it('defaults to All Notes when explicit organization is disabled in vault config', async () => {
    const workVaultPath = '/Users/mock/Documents/Work'
    mockCommandResults.load_vault_list = {
      vaults: [{ label: 'Work Vault', path: workVaultPath }],
      active_vault: workVaultPath,
      hidden_defaults: [],
    }
    const disabledWorkflowConfig = JSON.stringify({
      zoom: null,
      view_mode: null,
      editor_mode: null,
      tag_colors: null,
      status_colors: null,
      property_display_modes: null,
      inbox: { noteListProperties: null, explicitOrganization: false },
    })
    localStorage.setItem(`laputa:vault-config:${workVaultPath}`, disabledWorkflowConfig)

    render(<App />)

    await waitFor(() => {
      expect(within(screen.getByTestId('sidebar-top-nav')).queryByText('Inbox')).not.toBeInTheDocument()
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })
  })

  it('starts on Inbox when the vault opted in, and on All Notes otherwise', async () => {
    enableExplicitOrganization()
    const optedIn = render(<App />)
    const noteList = await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    await waitFor(() => expect(getHeaderForNoteList(noteList)).toHaveTextContent('Inbox'))
    expect(within(screen.getByTestId('sidebar-top-nav')).getByText('Inbox')).toBeInTheDocument()
    optedIn.unmount()

    localStorage.removeItem('laputa:vault-config:/vault')
    render(<App />)
    const calmList = await screen.findByTestId('note-list-container', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    await waitFor(() => expect(getHeaderForNoteList(calmList)).toHaveTextContent('Notes'))
    expect(within(screen.getByTestId('sidebar-top-nav')).queryByText('Inbox')).not.toBeInTheDocument()
  }, SLOW_APP_READY_TIMEOUT_MS * 2)

  it('auto-advances to the next inbox item after organizing when the setting is enabled', async () => {
    configureNeighborhoodVault()
    enableExplicitOrganization()
    mockCommandResults.get_settings = createSettings({ auto_advance_inbox_after_organize: true })

    render(<App />)

    const noteListContainer = await screen.findByTestId('note-list-container')
    await waitFor(() => {
      expect(getHeaderForNoteList(noteListContainer)).toHaveTextContent('Inbox')
    })

    await clickNoteListItem(noteListContainer, 'Alpha')

    // The editor loads lazily; when this test runs first it pays that cost.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Set note as organized' })).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Set note as organized' }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(window.__laputaTest?.activeTabPath).toBe('/vault/beta.md')
    })
  }, 10_000)

  it('keeps the manually selected note after organizing finishes later', async () => {
    configureNeighborhoodVault()
    enableExplicitOrganization()
    mockCommandResults.get_settings = createSettings({ auto_advance_inbox_after_organize: true })

    let resolveOrganizeSave!: () => void
    const organizeSave = new Promise<void>((resolve) => {
      resolveOrganizeSave = resolve
    })
    mockCommandResults.save_note_content = vi.fn(() => organizeSave)

    render(<App />)

    const noteListContainer = await screen.findByTestId('note-list-container')
    await waitFor(() => {
      expect(getHeaderForNoteList(noteListContainer)).toHaveTextContent('Inbox')
    })

    await clickNoteListItem(noteListContainer, 'Alpha')

    // The editor loads lazily; when this test runs first it pays that cost.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Set note as organized' })).toBeInTheDocument()
    }, { timeout: SLOW_APP_READY_TIMEOUT_MS })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Set note as organized' }))
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.click(within(noteListContainer).getByText('Gamma'))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(window.__laputaTest?.activeTabPath).toBe('/vault/gamma.md')
    })

    await act(async () => {
      resolveOrganizeSave()
      await organizeSave
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.__laputaTest?.activeTabPath).toBe('/vault/gamma.md')
  }, 10_000)

  it('renders status bar', async () => {
    render(<App />)
    // StatusBar should be present
    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })
    // The status bar element should exist in the DOM
    const appShell = document.querySelector('.app-shell')
    expect(appShell).toBeInTheDocument()
  })

  it('switches vaults from the bottom bar after onboarding is ready', async () => {
    let resolveSwitchedVaultScan: ((value: typeof mockEntries) => void) | null = null
    const switchedVaultScan = new Promise<typeof mockEntries>((resolve) => {
      resolveSwitchedVaultScan = resolve
    })
    mockCommandResults.load_vault_list = {
      vaults: [
        { label: 'Test Vault', path: '/work' },
        { label: 'Work Vault', path: '/vault-2' },
      ],
      active_vault: '/work',
      hidden_defaults: [],
    }
    mockCommandResults.list_vault = ({ path }: { path?: string } = {}) =>
      path === '/vault-2' ? switchedVaultScan : mockEntries

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('status-vault-trigger')).toHaveTextContent('Test Vault')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByTestId('vault-menu-item-Work Vault'))

    expect(await screen.findByTestId('sidebar-loading-favorites')).toBeInTheDocument()
    expect(screen.queryByTestId('startup-shell-fallback')).not.toBeInTheDocument()
    expect(screen.getByTestId('note-list-loading-skeleton')).toBeInTheDocument()

    await act(async () => {
      resolveSwitchedVaultScan?.(mockEntries)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('status-vault-trigger')).toHaveTextContent('Work Vault')
    })
  })

  it('clears the Git setup dialog when switching to a Git-enabled vault', async () => {
    enableUpstreamRemotePolicy()
    mockCommandResults.load_vault_list = {
      vaults: [
        { label: 'Missing Git', path: '/work' },
        { label: 'Git Vault', path: '/vault-2' },
      ],
      active_vault: '/work',
      hidden_defaults: [],
    }
    mockCommandResults.is_git_repo = ({ vaultPath }: { vaultPath?: string } = {}) => vaultPath === '/vault-2'

    render(<App />)

    expect(await screen.findByTestId('status-missing-git', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('status-missing-git'))
    expect(await screen.findByText('Enable Git for this vault?')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('status-vault-trigger'))
    fireEvent.click(screen.getByTestId('vault-menu-item-Git Vault'))

    await waitFor(() => {
      expect(screen.getByTestId('status-vault-trigger')).toHaveTextContent('Git Vault')
    })
    await waitFor(() => {
      expect(screen.queryByText('Enable Git for this vault?')).not.toBeInTheDocument()
    })
  })

  it('Cmd+1 hides sidebar and note list (editor-only mode)', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })

    // All panels visible by default
    expect(document.querySelector('.app__sidebar')).toBeInTheDocument()
    expect(document.querySelector('.app__note-list')).toBeInTheDocument()

    // Cmd+1 → editor-only
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    await waitFor(() => {
      expect(document.querySelector('.app__sidebar')).not.toBeInTheDocument()
      expect(document.querySelector('.app__note-list')).not.toBeInTheDocument()
    })
  })

  it('Cmd+2 shows editor + note list (sidebar hidden)', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: '2', metaKey: true })
    await waitFor(() => {
      expect(document.querySelector('.app__sidebar')).not.toBeInTheDocument()
      expect(document.querySelector('.app__note-list')).toBeInTheDocument()
    })
  })

  it('Cmd+3 restores all panels after Cmd+1', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })

    // Switch to editor-only first
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    await waitFor(() => {
      expect(document.querySelector('.app__sidebar')).not.toBeInTheDocument()
    })

    // Cmd+3 → all panels
    fireEvent.keyDown(window, { key: '3', metaKey: true })
    await waitFor(() => {
      expect(document.querySelector('.app__sidebar')).toBeInTheDocument()
      expect(document.querySelector('.app__note-list')).toBeInTheDocument()
    })
  })

  it('updates the main-window size constraints when the view mode changes', async () => {
    const invoke = vi.mocked((await import('@tauri-apps/api/core')).invoke)

    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('All Notes')).toBeInTheDocument()
    })

    invoke.mockClear()

    fireEvent.keyDown(window, { key: '1', metaKey: true })
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', {
        minWidth: 480,
        minHeight: 400,
        growToFit: true,
      })
    })

    invoke.mockClear()

    fireEvent.keyDown(window, { key: '3', metaKey: true })
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', {
        minWidth: 1030,
        minHeight: 400,
        growToFit: true,
      })
    })
  })

  it('does not ask Windows to grow the native window when toggling Properties', async () => {
    const invoke = vi.mocked((await import('@tauri-apps/api/core')).invoke)
    const originalUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    try {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText('All Notes')).toBeInTheDocument()
      })

      invoke.mockClear()

      fireEvent.keyDown(window, { key: 'I', metaKey: true, shiftKey: true })
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('update_current_window_min_size', expect.objectContaining({
          growToFit: false,
        }))
      })
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent,
      })
    }
  })

  // Seam: App's wiring of the page barriers. Catches property writes, title renames and folder moves running unguarded.
  const PAGE = '/vault/project/test.md'
  const BUSY = 'This page is busy with another change. Try again in a moment.'
  const flushTasks = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

  it('runs property writes and title renames through the page barrier, and says when a page is busy', async () => {
    render(<App />)
    await screen.findAllByText('Test Project', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    const { runPageExclusive, runManualRename } = appWiring.noteActions!
    let finishWrite = () => {}
    let writing: Promise<boolean> | undefined
    act(() => { writing = runPageExclusive!(PAGE, () => new Promise(resolve => { finishWrite = () => resolve(true) })) })
    const rename = vi.fn(async () => {})
    let renaming: Promise<void> | undefined
    act(() => { renaming = runManualRename!(PAGE, rename) })
    await flushTasks()
    expect(rename).not.toHaveBeenCalled()

    await act(async () => { finishWrite(); await writing; await renaming })
    expect(rename).toHaveBeenCalledOnce()
    const reopen = appWiring.appSave!.holdManualRenameAdmission()
    const refused = vi.fn(async () => {})
    await act(() => runManualRename!(PAGE, refused))
    reopen()
    expect(refused).not.toHaveBeenCalled()
    expect(await screen.findByText(BUSY)).toBeInTheDocument()
  })

  it('holds page renames while a folder moves, after letting one already running finish', async () => {
    render(<App />)
    await screen.findAllByText('Test Project', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    const { runManualRename } = appWiring.noteActions!
    let finishRename = () => {}
    let running: Promise<void> | undefined
    act(() => { running = runManualRename!(PAGE, () => new Promise<void>(resolve => { finishRename = resolve })) })
    await flushTasks()
    let preparing: Promise<FolderMoveHold> | undefined
    let prepared = false
    act(() => { preparing = appWiring.prepareFolderMove!('/vault/project'); void preparing.then(() => { prepared = true }) })
    const late = vi.fn(async () => {})
    await act(() => runManualRename!(PAGE, late))
    await flushTasks()
    expect(late).not.toHaveBeenCalled()
    expect(prepared).toBe(false)

    await act(async () => { finishRename(); await running })
    const hold = await act(() => preparing!)
    hold.release()
    const after = vi.fn(async () => {})
    await act(() => runManualRename!(PAGE, after))
    expect(after).toHaveBeenCalledOnce()
  })

  // Seam: close and vault switch against page renames and moves. Catches the newest text lost to a rename's older copy.
  const NEWEST = '# Test Project\n\nNewest words.'
  const RENAMED = '/vault/project/renamed.md'
  const MOVED = '/vault/topic/test.md'

  // Like the native worker: a rename or move reads the body first and publishes it only when let go.
  function installStagingDisk() {
    const disk = new Map([[PAGE, mockAllContent[PAGE]]])
    const native = { release: () => {}, renames: 0, moves: 0, saveFails: false }
    const released = new Promise<void>(resolve => { native.release = resolve })
    const publish = async (from: string, to: string) => {
      const staged = disk.get(from) ?? ''
      await released
      disk.delete(from)
      disk.set(to, staged)
      return { new_path: to, updated_files: 0, failed_updates: 0 }
    }
    mockCommandResults.save_note_content = ({ path, content }: { path: string, content: string }) => {
      if (native.saveFails) throw new Error('disk full')
      disk.set(path, content)
      return null
    }
    mockCommandResults.save_page_content = ({ request, content }: { request: { path: string }, content: string }) => {
      if (native.saveFails) return { status: 'refused', reason: 'stageFailed' }
      disk.set(request.path, content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    mockCommandResults.get_note_content = ({ path }: { path: string }) => disk.get(path) ?? ''
    mockCommandResults.list_vault = () => [...disk.keys()].map(path => ({ ...mockEntries[0], path, filename: path.split('/').pop() }))
    mockCommandResults.rename_note_filename = ({ old_path, new_filename_stem }: { old_path: string, new_filename_stem: string }) => {
      native.renames += 1
      return publish(old_path, `${old_path.slice(0, old_path.lastIndexOf('/'))}/${new_filename_stem}.md`)
    }
    mockCommandResults.move_note_to_folder = ({ old_path, folder_path }: { old_path: string, folder_path: string }) => {
      native.moves += 1
      return publish(old_path, `/vault/${folder_path}/${old_path.split('/').pop()}`)
    }
    return { disk, native }
  }

  async function renderReadyApp() {
    render(<App />)
    await screen.findAllByText('Test Project', {}, { timeout: SLOW_APP_READY_TIMEOUT_MS })
    return appWiring.appSave!
  }

  function startTracked(start: () => Promise<unknown>) {
    const state = { settled: false, done: Promise.resolve() as Promise<unknown> }
    act(() => { state.done = start().then(() => { state.settled = true }) })
    return state
  }

  it('runs page moves through the rename barrier, and close waits for one already running', async () => {
    const { disk, native } = installStagingDisk()
    const app = await renderReadyApp()
    const move = () => appWiring.moveNoteToFolder!(PAGE, 'topic', '/vault', () => {})
    const reopen = app.holdManualRenameAdmission()
    await act(async () => { expect(await move()).toBeNull() })
    reopen()
    expect(native.moves).toBe(0)
    expect(await screen.findByText(BUSY)).toBeInTheDocument()

    const moving = startTracked(move)
    await flushTasks()
    expect(native.moves).toBe(1)
    act(() => { app.handleContentChange(PAGE, NEWEST) })
    const closing = startTracked(() => appWiring.closeFlush!())
    await flushTasks()
    expect(closing.settled).toBe(false)

    await act(async () => { native.release(); await moving.done; await closing.done })
    expect(Object.fromEntries(disk)).toEqual({ [MOVED]: NEWEST })
  })

  it('close waits for a page rename that started first, refuses new ones, then saves the newest text at the new name', async () => {
    const { disk, native } = installStagingDisk()
    const app = await renderReadyApp()
    const renaming = startTracked(() => app.handleFilenameRename(PAGE, 'renamed'))
    await flushTasks()
    expect(native.renames).toBe(1)
    act(() => { app.handleContentChange(PAGE, NEWEST) })
    const closing = startTracked(() => appWiring.closeFlush!())
    await flushTasks()
    expect(closing.settled).toBe(false)
    expect(disk.get(PAGE)).toBe(mockAllContent[PAGE])
    await act(() => app.handleFilenameRename(PAGE, 'other'))
    expect(native.renames).toBe(1)
    expect(await screen.findByText(BUSY)).toBeInTheDocument()

    await act(async () => { native.release(); await renaming.done; await closing.done })
    expect(Object.fromEntries(disk)).toEqual({ [RENAMED]: NEWEST })
  })

  it('vault switch waits for a page rename that started first, then saves the open page at its new name', async () => {
    const { disk, native } = installStagingDisk()
    const app = await renderReadyApp()
    await act(() => appWiring.notes!.handleSelectNote(appWiring.noteActions!.entries[0]))
    const renaming = startTracked(() => app.handleFilenameRename(PAGE, 'renamed'))
    await flushTasks()
    act(() => { app.handleContentChange(PAGE, NEWEST) })
    const switching = startTracked(async () => appWiring.switchVault!())
    await flushTasks()
    expect(native.renames).toBe(1)
    expect(switching.settled).toBe(false)
    expect(disk.get(PAGE)).toBe(mockAllContent[PAGE])

    await act(async () => { native.release(); await renaming.done; await switching.done })
    expect(Object.fromEntries(disk)).toEqual({ [RENAMED]: NEWEST })
  })

  it('lets page renames run again after a close that could not save', async () => {
    const { disk, native } = installStagingDisk()
    const app = await renderReadyApp()
    await act(() => appWiring.notes!.handleSelectNote(appWiring.noteActions!.entries[0]))
    act(() => { app.handleContentChange(PAGE, NEWEST) })
    native.saveFails = true
    await act(async () => { await expect(appWiring.closeFlush!()).rejects.toThrow() })

    native.saveFails = false
    native.release()
    await act(() => app.handleFilenameRename(PAGE, 'renamed'))
    expect(native.renames).toBe(1)
    expect(Object.fromEntries(disk)).toEqual({ [RENAMED]: NEWEST })
  })

  // Seam: quit and vault switch against the pending draft field. Catches words stranded in a vault being left.
  const draftField = () => screen.queryByRole('textbox', { name: 'Your draft' })
  const pressNewPage = () => fireEvent.keyDown(window, { key: 'n', code: 'KeyN', metaKey: true })

  it('a vault switch drops an empty draft, lets no new draft start while it waits, then refuses one with words', async () => {
    const { native } = installStagingDisk()
    const app = await renderReadyApp()
    pressNewPage()
    expect(draftField()).toBeInTheDocument()
    const renaming = startTracked(() => app.handleFilenameRename(PAGE, 'renamed'))
    await flushTasks()
    const switching = startTracked(async () => appWiring.switchVault!())
    await flushTasks()
    expect(draftField()).toBeNull()
    pressNewPage()
    await flushTasks()
    expect(draftField()).toBeNull()
    await act(async () => { native.release(); await renaming.done; await switching.done })
    expect(switching.settled).toBe(true)

    pressNewPage()
    fireEvent.change(draftField()!, { target: { value: 'Harbor fog' } })
    await act(async () => { await expect(appWiring.switchVault!()).rejects.toThrow() })
    expect(draftField()).toHaveValue('Harbor fog')
  })

  it('quit refuses at once while the draft holds words or an open composition, leaving it editable', async () => {
    const { native } = installStagingDisk()
    const app = await renderReadyApp()
    pressNewPage()
    const field = draftField()!
    fireEvent.compositionStart(field)
    fireEvent.change(field, { target: { value: '港' } })
    // A running rename holds an ordinary quit; a draft with words must not wait behind it.
    const renaming = startTracked(() => app.handleFilenameRename(PAGE, 'renamed'))
    await flushTasks()
    let refused = false
    act(() => { void appWiring.closeFlush!().catch(() => { refused = true }) })
    await flushTasks()
    expect(refused).toBe(true)
    expect(document.activeElement).toBe(field)
    expect(field).toHaveValue('港')
    await act(async () => { native.release(); await renaming.done })
  })
})
