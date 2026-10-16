import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { TemplateDialog } from './TemplateDialog'
import type { TemplateController, TemplateSnapshot } from './templateContract'
import { useTemplateUi } from './useTemplateUi'

function entry(path: string, template = '## Start'): VaultEntry {
  return { path, filename: path.split('/').pop()!, title: 'Meeting', isA: 'Type', template, aliases: [], belongsTo: [], relatedTo: [],
    status: null, archived: false, modifiedAt: null, createdAt: null, fileSize: 100, snippet: '', wordCount: 0, relationships: {},
    icon: null, color: null, order: null, sidebarLabel: null, sort: null, view: null, visible: null, organized: false,
    favorite: false, favoriteIndex: null, listPropertiesDisplay: [], outgoingLinks: [], properties: {}, hasH1: false }
}
const entries = [entry('/vault/A/meeting.md'), entry('/vault/B/meeting.md', '')]
function mount() {
  const controller: TemplateController = {
    begin: vi.fn(() => ({ id: 'one', vaultPath: '/vault', cancel: vi.fn() })), holdAdmission: () => () => {}, whenIdle: async () => {},
    prepare: vi.fn(async (_scope, source) => {
      const chosen = entries.find(item => item.path === source.path)!
      const snapshot: TemplateSnapshot = { source, title: chosen.title, template: chosen.template, defaults: [{ key: 'Priority', value: 2, kind: 'property' }], destinationDirectory: source.path.includes('/A/') ? 'A' : 'B', revision: chosen.template ?? '' }
      return { status: 'ready', snapshot, preview: chosen.template ? { snapshot, content: chosen.template } : null }
    }),
    save: vi.fn(async (_scope, draft) => ({ status: 'failed', reason: 'saveHeld', write: 'notStarted', revision: draft.revision })),
    create: vi.fn(async () => ({ status: 'failed', reason: 'unconfirmed', write: 'unconfirmed', attemptedPath: '/vault/A/result.md' })),
  }
  function Harness() {
    const ui = useTemplateUi({ controller, vaultPath: '/vault', locale: 'en', blocked: () => false, onHeld: vi.fn() })
    return <><button onClick={ui.open}>Open templates</button><TemplateDialog ui={ui} entries={entries} locale="en" /></>
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Open templates' }))
  return controller
}

describe('template dialog', () => {
  it('disambiguates duplicate names by path and lets an empty template be edited without creating a page', async () => {
    const controller = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Meeting B/meeting.md' }))
    await screen.findByText('This template has no starting text. Edit it to make it available for creating pages.')
    expect(controller.prepare).toHaveBeenCalledWith(expect.anything(), { vaultPath: '/vault', path: '/vault/B/meeting.md' })
    expect(screen.getByRole('button', { name: 'Create page' })).toBeDisabled()
    expect(screen.getByText('Priority: 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit template' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Starting text' })).toHaveValue('')
  })

  it('retains failed text through Escape and explicitly discards it only after confirmation', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Meeting A/meeting.md' }))
    await screen.findByTestId('template-preview-formatted')
    fireEvent.click(screen.getByRole('button', { name: 'Edit template' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Starting text' }), { target: { value: 'Kept words' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(screen.getByTestId('template-editor-status')).toHaveTextContent('unsaved changes'))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Starting text' }), { key: 'Escape' })
    await screen.findByRole('alertdialog')
    expect(screen.getByRole('textbox', { name: 'Starting text' })).toHaveValue('Kept words')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await screen.findByTestId('template-preview-formatted')
    expect(screen.queryByRole('textbox', { name: 'Starting text' })).toBeNull()
  })

  it('locks an unconfirmed create to the visible path and makes closing an explicit abandonment', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Meeting A/meeting.md' }))
    await screen.findByTestId('template-preview-formatted')
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))
    await screen.findByRole('button', { name: 'Check again' })
    expect(screen.getByTestId('template-attempted-path')).toHaveAttribute('data-path', '/vault/A/result.md')
    expect(screen.getByRole('button', { name: 'Meeting B/meeting.md' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New template' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('A file may already have been written')
    fireEvent.click(screen.getByRole('button', { name: 'Close and keep any file' }))
    expect(screen.queryByTestId('template-dialog')).toBeNull()
  })
})
