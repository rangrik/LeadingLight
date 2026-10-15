import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../lib/i18n'
import {
  EditorTestHarness as Editor,
  defaultProps,
  flushEditorSwapWork,
  mockContent,
  mockEditor,
  mockEntry,
  render,
  resetEditorTestState,
} from './Editor.helpers.test'

const untitled = { entry: { ...mockEntry, path: '/vault/project/untitled-note-1.md', filename: 'untitled-note-1.md' }, content: mockContent }
const renamed = { entry: { ...mockEntry, path: '/vault/project/test-project.md', filename: 'test-project.md' }, content: mockContent }
const other = { entry: { ...mockEntry, path: '/vault/project/other.md', filename: 'other.md', title: 'Other' }, content: '# Other\n\nElsewhere.\n' }
// A different file whose name matches the draft's title and whose text starts with the draft's text.
const sameTitlePage = { entry: renamed.entry, content: `${mockContent}\nExisting text only this page has.\n` }
type Tab = typeof untitled & { renamedFrom?: string }
let readAsDataURL: ReturnType<typeof vi.spyOn<FileReader, 'readAsDataURL'>>

function renderPage(tab: Tab, onToast = vi.fn()) {
  const props = { ...defaultProps, entries: [untitled.entry, renamed.entry, other.entry], vaultPath: '/vault', onToast }
  const view = render(<Editor {...props} tabs={[tab]} activeTabPath={tab.entry.path} />)
  return { onToast, show: (next: Tab) => view.rerender(<Editor {...props} tabs={[next]} activeTabPath={next.entry.path} />) }
}

function dropImage() {
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] } })
  act(() => { document.querySelector('.editor__blocknote-container')!.dispatchEvent(drop) })
}

async function finishRead(outcome: 'load' | 'error') {
  const reader = readAsDataURL.mock.contexts.at(-1) as FileReader
  await act(async () => {
    if (outcome === 'load') Object.defineProperty(reader, 'result', { value: 'data:image/png;base64,AAA' })
    reader[outcome === 'load' ? 'onload' : 'onerror']?.(new ProgressEvent(outcome) as ProgressEvent<FileReader>)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const insertedImage = () => mockEditor.insertBlocks.mock.calls.some(([blocks]) => (blocks as { type: string }[])[0]?.type === 'image')
const showDraftTitledTestProject = () => {
  mockEditor.document = [
    { id: 'h', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Test Project', styles: {} }], children: [] },
    { id: 'p', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'This is a test note with some words to count.', styles: {} }], children: [] },
  ]
  return renderPage(untitled)
}

beforeEach(() => {
  resetEditorTestState()
  mockEditor.insertBlocks.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // Held until the test finishes the read, like a slow local copy.
  readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => {})
})

describe('Editor image import', () => {
  it('names the image in a toast when its copy fails', async () => {
    const page = renderPage(renamed)
    await flushEditorSwapWork()
    dropImage()
    await finishRead('error')
    expect(page.onToast).toHaveBeenCalledWith(translate('en', 'editor.imageImport.copyFailed', { filename: 'photo.png' }))
  })

  it('inserts an image whose copy finishes after the untitled page renames itself', async () => {
    const page = showDraftTitledTestProject()
    await flushEditorSwapWork()
    dropImage()
    // A real rename updates the same tab in place; the split workspace records where it came from.
    page.show({ ...renamed, renamedFrom: untitled.entry.path })
    await flushEditorSwapWork()
    await finishRead('load')
    expect(insertedImage()).toBe(true)
  })

  it('does not insert into a different page that only shares the draft title and opening text', async () => {
    const page = showDraftTitledTestProject()
    await flushEditorSwapWork()
    dropImage()
    page.show(sameTitlePage)
    await flushEditorSwapWork()
    await finishRead('load')
    expect(insertedImage()).toBe(false)
  })

  it('does not insert into the next page after a real page switch', async () => {
    const page = renderPage(renamed)
    await flushEditorSwapWork()
    dropImage()
    page.show(other)
    await flushEditorSwapWork()
    await finishRead('load')
    expect(insertedImage()).toBe(false)
  })
})
