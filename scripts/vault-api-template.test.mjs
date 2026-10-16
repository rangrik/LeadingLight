import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseMarkdownFile } from './vault-api-data.ts'
import { runVaultCommand } from './vault-api-commands.ts'

// Parser-only tests: no server and no real notes. Expected forms match native StringOrList/defaults.
test('exact local template reads preserve native supported scalar, list, and body forms', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'leadinglight-template-parser-'))
  try {
    const fixtures = [
      ['block', 'type: Type\ntemplate: |\n  ## Steps\n  - [ ] Read\nPriority: [2]\nReady: [false]', '## Steps\n- [ ] Read\n', { Priority: 2, Ready: false }],
      ['list', 'type: [Type]\ntemplate: ["## First", "## Ignored"]', '## First', {}],
      ['empty-list', 'type: Type\ntemplate: []', '', {}],
      ['empty-string', 'type: Type\ntemplate: ""', '', {}],
      ['fallback', 'type: Type', '## Body fallback', {}],
    ]
    for (const [name, metadata, template, properties] of fixtures) {
      const file = path.join(root, `${name}.md`)
      writeFileSync(file, `---\n${metadata}\n---\n# Plan\n\n## Body fallback\n`.replaceAll('\n', '\r\n'))
      const entry = parseMarkdownFile(file)
      assert.equal(entry?.isA, 'Type', name)
      assert.equal(entry?.template?.replaceAll('\r\n', '\n'), template, name)
      assert.deepEqual(entry?.properties, properties, name)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('exact entry reload validates the explicit root including symlink escape', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'leadinglight-template-root-'))
  try {
    const vault = path.join(root, 'vault')
    mkdirSync(vault)
    const outside = path.join(root, 'outside.md')
    const inside = path.join(vault, 'type.md')
    writeFileSync(outside, '---\ntype: Type\n---\n# Outside')
    writeFileSync(inside, '---\ntype: Type\n---\n# Inside')
    const link = path.join(vault, 'alias.md')
    symlinkSync(outside, link)
    const reload = file => runVaultCommand({ cmd: 'reload_vault_entry', args: { path: file, vault_path: vault } })
    assert.equal(reload(inside).payload.title, 'Inside')
    assert.equal(reload(outside).statusCode, 400)
    assert.equal(reload(link).statusCode, 400)
    const content = file => runVaultCommand({ cmd: 'get_note_content', args: { path: file, vault_path: vault } })
    assert.equal(content(inside).payload.content.includes('# Inside'), true)
    assert.equal(content(outside).statusCode, 400)
    assert.equal(content(link).statusCode, 400)
    assert.equal(content(path.join(vault, 'absent.md')).statusCode, 404)
    assert.match(content(path.join(vault, 'absent.md')).payload.error, /ENOENT/)
    assert.equal(content(path.join(root, 'outside-absent.md')).statusCode, 400)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
