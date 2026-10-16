import { APP_COMMAND_EVENT_NAME } from '../../hooks/appCommandDispatcher'

export const BACKUP_DIALOG_ATTRIBUTE = 'data-backup-dialog'

let holds = 0

/** From Choose folder until the backup ends: keys reach only its dialog, never as shortcuts, and app commands stop. */
export function holdBackupInput(): () => void {
  holds += 1
  let open = true
  return () => {
    if (!open) return
    open = false
    holds -= 1
  }
}

export const backupInputHeld = () => holds > 0

const inDialog = (target: EventTarget | null) => target instanceof Element && target.closest(`[${BACKUP_DIALOG_ATTRIBUTE}]`) !== null

function block(event: Event) {
  if (holds === 0) return
  if (event instanceof KeyboardEvent && !event.metaKey && !event.ctrlKey && inDialog(event.target)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

// Added once at load, so it runs before any window listener a component adds later.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', block, true)
  window.addEventListener(APP_COMMAND_EVENT_NAME, block, true)
}

/** Native menu commands never pass through the DOM, so their handlers, and the refs they read, are empty while guarded. */
export function useGuardedHandlers<H extends object>(handlers: H, guarded: () => boolean): H {
  const wrapped: Record<string, unknown> = { ...(handlers as Record<string, unknown>) }
  for (const [key, value] of Object.entries(wrapped)) {
    if (typeof value === 'function') wrapped[key] = (...args: unknown[]) => (guarded() ? undefined : value(...args))
    else if (typeof value === 'object' && value !== null && 'current' in value) {
      const ref = value as { current: unknown }
      wrapped[key] = { get current() { return guarded() ? null : ref.current }, set current(next) { ref.current = next } }
    }
  }
  return wrapped as H
}
