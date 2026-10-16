import { describe, expect, it } from 'vitest'
import { parseRelocationReceipt, relocatedPageContent } from './relocationContract'

const request = { sourcePath: '/vault/drafts/source.md', destinationPath: '/vault/filed/source.md', openPaths: ['/vault/drafts/source.md', '/vault/incoming.md', '/vault/failed.md'] }
const receipt = {
  new_path: request.destinationPath, updated_files: 1, failed_updates: 1,
  source_before_content: '[ref](./ref.md)', source_content: '[ref](../drafts/ref.md)',
  updated_open_pages: [{ path: '/vault/incoming.md', before_content: 'before', content: 'after' }],
  unrefreshed_open_paths: ['/vault/failed.md'],
}

describe('folder relocation receipt', () => {
  it('accepts only the requested destination and requested distinct incoming pages', () => {
    expect(parseRelocationReceipt(receipt, request)).toEqual(receipt)
    expect(parseRelocationReceipt({ ...receipt, new_path: '/elsewhere/source.md' }, request)).toBeNull()
    expect(parseRelocationReceipt({ ...receipt, updated_open_pages: [{ ...receipt.updated_open_pages[0], path: '/vault/unrequested.md' }] }, request)).toBeNull()
    expect(parseRelocationReceipt({ ...receipt, unrefreshed_open_paths: ['/vault/incoming.md'] }, request)).toBeNull()
    expect(parseRelocationReceipt({ ...receipt, source_content: undefined }, request)).toBeNull()
  })
  it('supplies exact committed text only for matching baselines and keeps failed pages unavailable', () => {
    expect(relocatedPageContent(receipt, request.sourcePath, receipt.source_before_content, request.sourcePath)).toBe(receipt.source_content)
    expect(relocatedPageContent(receipt, request.sourcePath, 'newer words', request.sourcePath)).toBeNull()
    expect(relocatedPageContent(receipt, '/vault/incoming.md', 'before', request.sourcePath)).toBe('after')
    expect(relocatedPageContent(receipt, '/vault/incoming.md', 'newer words', request.sourcePath)).toBeNull()
    expect(relocatedPageContent(receipt, '/vault/failed.md', 'before', request.sourcePath)).toBeNull()
    expect(relocatedPageContent(receipt, '/vault/unchanged.md', 'same', request.sourcePath)).toBe('same')
  })
})
