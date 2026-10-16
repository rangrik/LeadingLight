import { Check, StackSimple } from '@phosphor-icons/react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export interface RetargetOption {
  id: string
  label: string
  detail?: string
  current?: boolean
}

interface RetargetNoteDialogProps {
  busy?: boolean
  workingLabel?: string
  currentLabel?: string
  open: boolean
  title: string
  description: string
  searchPlaceholder: string
  emptyMessage: string
  options: RetargetOption[]
  onClose: () => void
  onSelect: (id: string) => boolean | Promise<boolean>
  testIdPrefix: string
}

function matchesQuery(option: RetargetOption, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return option.label.toLowerCase().includes(normalized) || option.detail?.toLowerCase().includes(normalized) || false
}

function initialHighlightIndex(options: RetargetOption[]): number {
  if (options.length === 0) return -1
  const currentIndex = options.findIndex((option) => option.current)
  return currentIndex >= 0 ? currentIndex : 0
}

function nextHighlightIndex(current: number, total: number, direction: 'next' | 'previous'): number {
  if (total === 0) return -1
  if (current < 0) return direction === 'next' ? 0 : total - 1
  return direction === 'next' ? (current + 1) % total : (current - 1 + total) % total
}

interface RetargetOptionsProps {
  disabled?: boolean
  currentLabel?: string
  effectiveHighlightedIndex: number
  emptyMessage: string
  options: RetargetOption[]
  onHighlight: (index: number) => void
  onSelect: (id: string) => void
  testIdPrefix: string
}

function RetargetOptions({
  disabled,
  currentLabel = 'Current',
  effectiveHighlightedIndex,
  emptyMessage,
  options,
  onHighlight,
  onSelect,
  testIdPrefix,
}: RetargetOptionsProps) {
  if (options.length === 0) {
    return <div className="px-4 py-6 text-sm text-muted-foreground" data-testid={`${testIdPrefix}-empty`}>{emptyMessage}</div>
  }
  return (
    <div className="p-1" data-testid={`${testIdPrefix}-options`}>
      {options.map((option, index) => (
        <Button
          key={option.id}
          type="button"
          disabled={disabled}
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start rounded-md px-3 py-2 text-left',
            effectiveHighlightedIndex === index && 'bg-accent text-accent-foreground',
          )}
          data-testid={`${testIdPrefix}-option:${option.id}`}
          onMouseMove={() => onHighlight(index)}
          onClick={() => onSelect(option.id)}
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span className="mt-0.5 shrink-0 text-muted-foreground">
              {option.current ? <Check size={14} weight="bold" /> : <StackSimple size={14} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{option.label}</span>
              {option.detail && <span className="truncate text-xs text-muted-foreground">{option.detail}</span>}
            </span>
          </div>
          {option.current && <span className="shrink-0 text-xs font-medium text-muted-foreground">{currentLabel}</span>}
        </Button>
      ))}
    </div>
  )
}

export function RetargetNoteDialog(functionOptions: RetargetNoteDialogProps) {
  const { open, title, description, searchPlaceholder, emptyMessage, options, onClose, onSelect, testIdPrefix } =
    functionOptions
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const submitting = useRef(false)
  const [localBusy, setLocalBusy] = useState(false)
  const pending = functionOptions.busy || localBusy

  const filteredOptions = useMemo(() => options.filter((option) => matchesQuery(option, query)), [options, query])

  const effectiveHighlightedIndex =
    highlightedIndex >= 0 && highlightedIndex < filteredOptions.length
    ? highlightedIndex
    : initialHighlightIndex(filteredOptions)

  const resetDialogState = () => {
    setQuery('')
    setHighlightedIndex(-1)
  }

  const submitSelection = async (optionId: string) => {
    if (submitting.current || functionOptions.busy) return
    submitting.current = true
    setLocalBusy(true)
    try {
      const shouldClose = await onSelect(optionId)
      if (!shouldClose) return
      resetDialogState()
      onClose()
    } finally {
      submitting.current = false
      setLocalBusy(false)
    }
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex(nextHighlightIndex(effectiveHighlightedIndex, filteredOptions.length, 'next'))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex(nextHighlightIndex(effectiveHighlightedIndex, filteredOptions.length, 'previous'))
      return
    }
    if (event.key === 'Enter' && effectiveHighlightedIndex >= 0) {
      event.preventDefault()
      const highlightedOption = filteredOptions.at(effectiveHighlightedIndex)
      if (highlightedOption) void submitSelection(highlightedOption.id)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || submitting.current || functionOptions.busy) return
        resetDialogState()
        onClose()
      }}
    >
      <DialogContent className="max-w-xl gap-3" showCloseButton={!pending} data-backup-dialog="" aria-busy={pending}
        onEscapeKeyDown={event => { if (submitting.current || functionOptions.busy) event.preventDefault() }}
        onInteractOutside={event => { if (submitting.current || functionOptions.busy) event.preventDefault() }}>
        <DialogHeader className="gap-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          disabled={pending}
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={searchPlaceholder}
          data-testid={`${testIdPrefix}-search`}
        />
        <ScrollArea className="max-h-80 rounded-md border">
          <RetargetOptions
            disabled={pending}
            currentLabel={functionOptions.currentLabel}
            effectiveHighlightedIndex={effectiveHighlightedIndex}
            emptyMessage={emptyMessage}
            options={filteredOptions}
            onHighlight={setHighlightedIndex}
            onSelect={(id) => { void submitSelection(id) }}
            testIdPrefix={testIdPrefix}
          />
        </ScrollArea>
        {pending && functionOptions.workingLabel && <p role="status" className="text-sm text-muted-foreground">{functionOptions.workingLabel}</p>}
      </DialogContent>
    </Dialog>
  )
}
