import { useLayoutEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { VaultEntry } from '../../types'
import { createTemplateController, type TemplateDomainDeps } from './templateDomain'
import type { TemplateController, TemplateSource } from './templateContract'

export function templateLocal<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

export function readTemplateEntry(source: TemplateSource): Promise<VaultEntry | null> {
  return templateLocal('reload_vault_entry', { ...source })
}

type TemplateOptions = Omit<TemplateDomainDeps, 'session' | 'readEntry' | 'readContent' | 'createFile'>

function bind(options: TemplateOptions, session: object): TemplateDomainDeps {
  return { ...options, session, readEntry: readTemplateEntry,
    readContent: (path, vaultPath) => templateLocal('get_note_content', { path, vaultPath }),
    createFile: (path, content, vaultPath) => templateLocal('create_note_content', { path, content, vaultPath }) }
}

function createBinding(initial: TemplateOptions) {
  let deps = bind(initial, {})
  return {
    controller: createTemplateController(() => deps),
    update(options: TemplateOptions) { deps = bind(options, deps.vaultPath === options.vaultPath ? deps.session : {}) },
    dispose() { deps = { ...deps, session: {}, ready: false } },
  }
}

/** Stable controller; a committed vault transition invalidates earlier scopes, including A → B → A. */
export function useLocalTemplates(options: TemplateOptions): TemplateController {
  const [binding] = useState(() => createBinding(options))
  useLayoutEffect(() => { binding.update(options) })
  useLayoutEffect(() => () => binding.dispose(), [binding])
  return binding.controller
}
