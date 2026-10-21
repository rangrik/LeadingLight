/**
 * Marks a managed rename the backend refused before publishing its source (Amendment B1). Native
 * (`rename_cmds.rs`), the browser disk bridge and the memory preview add it inside the completed
 * worker or request only, while the source is still in place. Any other rejection — a lost
 * transport, a panic — carries no marker and is unknown: it does not prove the worker stopped.
 * No imports, so the Node-run bridge can share it.
 */
export const RENAME_REFUSED_PREFIX = 'leadinglight-rename-refused: '

/** The refusal's own message when `error` is an explicit backend refusal, else null. */
export function knownRenameRefusal(error: unknown): string | null {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : null
  return message?.startsWith(RENAME_REFUSED_PREFIX) ? message.slice(RENAME_REFUSED_PREFIX.length) : null
}
