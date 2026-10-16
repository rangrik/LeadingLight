import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { translate, type AppLocale } from '../../lib/i18n'

export interface TemplateEditorProps {
  kind: 'new' | 'existing'
  name: string
  text: string
  sourcePath: string | null
  nameLocked?: boolean
  dirty: boolean
  saving: boolean
  blocked: boolean
  canSave: boolean
  status: string | null
  locale: AppLocale
  onNameChange: (name: string) => void
  onTextChange: (text: string) => void
  onSave: () => void
  onBack: () => void
}

/** The draft is owned above the form so dismissal and older save replies cannot lose text. */
export function TemplateEditor(props: TemplateEditorProps) {
  const { kind, name, text, sourcePath, nameLocked, dirty, saving, blocked, canSave, status, locale, onNameChange, onTextChange, onSave, onBack } = props
  return (
    <div className="ll-template-editor" data-testid="template-editor">
      <div className="ll-template-field">
        <label htmlFor="template-name">{translate(locale, 'leadinglight.templates.name')}</label>
        <Input id="template-name" value={name} readOnly={kind === 'existing' || nameLocked} disabled={blocked || (kind === 'new' && saving)}
          autoFocus={kind === 'new'} onChange={event => onNameChange(event.target.value)} />
        {sourcePath && <p className="ll-template-path">{sourcePath}</p>}
      </div>
      <div className="ll-template-field ll-template-text-field">
        <label htmlFor="template-text">{translate(locale, 'leadinglight.templates.text')}</label>
        <Textarea id="template-text" className="ll-template-textarea" value={text} disabled={blocked} autoFocus={kind === 'existing'}
          onChange={event => onTextChange(event.target.value)} placeholder={translate(locale, 'leadinglight.templates.textPlaceholder')} />
        <p className="ll-template-quiet">{translate(locale, kind === 'existing' && !text.trim() ? 'leadinglight.templates.emptyEdit' : 'leadinglight.templates.editorHint')}</p>
      </div>
      <p className="ll-template-status" role="status" data-testid="template-editor-status">{status ?? translate(locale, dirty ? 'leadinglight.templates.unsaved' : 'leadinglight.templates.editorReady')}</p>
      <div className="ll-template-footer">
        <Button variant="outline" disabled={blocked || saving} onClick={onBack}>{translate(locale, 'leadinglight.templates.back')}</Button>
        <Button disabled={blocked || saving || !canSave} onClick={onSave} data-testid="template-save">
          {translate(locale, saving ? 'leadinglight.templates.saving' : 'leadinglight.templates.save')}
        </Button>
      </div>
    </div>
  )
}
