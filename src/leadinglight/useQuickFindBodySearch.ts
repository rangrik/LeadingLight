import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'

export interface BodyMatch {
  path: string
  snippet: string
}

interface SearchResponse {
  results?: { path: string, snippet: string }[]
}

const DEBOUNCE_MS = 200
export const MIN_BODY_QUERY_LENGTH = 2

/** Snippets arrive as raw Markdown lines; show readable text only. */
export function plainSnippet(markdown: string): string {
  return markdown
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => alias || target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|[^\p{L}\p{N}])[*_]+|[*_]+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function searchVault(vaultPath: string, query: string): Promise<SearchResponse> {
  const args = { vaultPath, query, limit: 20, excludeFrontmatter: true }
  return isTauri() ? invoke<SearchResponse>('search_vault', args) : mockInvoke<SearchResponse>('search_vault', args)
}

interface SearchRequest {
  vaultPath: string
  query: string
  attempt: number
}

/**
 * Local page-text search. Each query, vault or retry is a new request object, and only that
 * object's own reply is shown: returning to an earlier query never reuses its old results.
 */
export function useQuickFindBodySearch(vaultPath: string, query: string, active: boolean) {
  const [attempt, setAttempt] = useState(0)
  const trimmed = query.trim()
  const searchable = active && !!vaultPath && trimmed.length >= MIN_BODY_QUERY_LENGTH
  const request = useMemo<SearchRequest | null>(
    () => (searchable ? { vaultPath, query: trimmed, attempt } : null),
    [searchable, vaultPath, trimmed, attempt],
  )
  const [settled, setSettled] = useState<{ request: SearchRequest, matches: BodyMatch[] | null } | null>(null)

  useEffect(() => {
    if (!request) return
    let current = true
    const timer = window.setTimeout(() => {
      searchVault(request.vaultPath, request.query).then(
        response => {
          const matches = (response?.results ?? []).map(({ path, snippet }) => ({ path, snippet: plainSnippet(snippet ?? '') }))
          if (current) setSettled({ request, matches })
        },
        () => { if (current) setSettled({ request, matches: null }) },
      )
    }, DEBOUNCE_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [request])

  const result = request && settled?.request === request ? settled : null
  const status = !request ? 'idle' : !result ? 'searching' : result.matches ? 'done' : 'failed'
  return { status, matches: result?.matches ?? [], retry: () => setAttempt(value => value + 1) } as const
}
