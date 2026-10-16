import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TemplateEditor, type TemplateEditorProps } from './TemplateEditor'

function props(overrides: Partial<TemplateEditorProps> = {}): TemplateEditorProps {
  return { kind: 'new', name: '', text: '', sourcePath: null, dirty: false, saving: false, blocked: false,
    status: null, canSave: false, locale: 'en', onNameChange: vi.fn(), onTextChange: vi.fn(), onSave: vi.fn(), onBack: vi.fn(), ...overrides }
}

describe('template editor', () => {
  it('has an explicit save and retains editable text while an earlier save is pending', () => {
    const p = props({ name: 'Meeting', text: '## Next steps', dirty: true, saving: true, canSave: true })
    render(<TemplateEditor {...p} />)
    expect(screen.getByRole('button', { name: 'Saving template…' })).toBeDisabled()
    const text = screen.getByRole('textbox', { name: 'Starting text' })
    expect(text).not.toBeDisabled()
    fireEvent.change(text, { target: { value: '## Later words' } })
    expect(p.onTextChange).toHaveBeenCalledWith('## Later words')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('keeps an existing template name and source read-only while allowing empty starting text', () => {
    const p = props({ kind: 'existing', name: 'Meeting', sourcePath: 'Types/Meeting.md', dirty: true, canSave: true })
    render(<TemplateEditor {...p} />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly')
    expect(screen.getByText('Types/Meeting.md')).toBeInTheDocument()
    expect(screen.getByText('An empty template will no longer be available for creating pages.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(p.onSave).toHaveBeenCalledOnce()
  })
})
