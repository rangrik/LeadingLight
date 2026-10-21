import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The collaboration server compiles these utilities through packages/markdown-yjs, without the app's
// React components or its `@/` alias. A type-only import still makes the compiler load its target,
// so the boundary is checked on every import, type-only ones included.

const root = process.cwd()

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const specifiers = (source: string) =>
  SPECIFIER_PATTERNS.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1] ?? ''))

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = join(dirname(fromFile), specifier.split('?')[0] ?? specifier)
  const candidates = [`${base}.ts`, `${base}.tsx`, base, join(base, 'index.ts'), join(base, 'index.tsx')]
  return candidates.find(path => existsSync(path) && statSync(path).isFile()) ?? null
}

const shown = (file: string) => relative(root, file).replaceAll('\\', '/')

function reachableFrom(entries: string[]): { files: string[]; aliased: string[] } {
  const seen = new Set<string>()
  const aliased: string[] = []
  const queue = entries.map(entry => join(root, entry))
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !/\.tsx?$/.test(file)) continue
    seen.add(file)
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('@/')) aliased.push(`${shown(file)} imports ${specifier}`)
      const target = specifier.startsWith('.') ? resolveLocal(file, specifier) : null
      if (target) queue.push(target)
    }
  }
  return { files: [...seen].map(shown), aliased }
}

describe('the pure frontmatter utilities', () => {
  it('reach no React component and no app-only alias, so the collaboration server can compile them', () => {
    const { files, aliased } = reachableFrom(['src/utils/noteTitle.ts', 'src/utils/frontmatter.ts'])
    expect(files).toContain('src/utils/frontmatterValue.ts')
    expect(files.filter(file => file.startsWith('src/components/'))).toEqual([])
    expect(aliased).toEqual([])
  })

  it('keep the property value type in an import-free leaf', () => {
    expect(specifiers(readFileSync(join(root, 'src/utils/frontmatterValue.ts'), 'utf8'))).toEqual([])
  })
})
