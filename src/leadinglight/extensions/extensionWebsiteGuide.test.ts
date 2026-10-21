import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import guide from '../../../docs/leadinglight/extensions-catalog.md?raw'
import { CAPABILITIES, E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES, STEP_OPERATIONS } from './extensionContract'
import { reviewPackage } from './extensionRecipe'
import { parseExtensionPackage } from './extensionSchema'

/**
 * The extension guide (extensions-catalog.md) is what Adapt sends with every request, and the model is
 * told to use only the steps and capabilities it lists. Its complete command examples must be real
 * commands, and its step and capability tables must list exactly the vocabulary.
 */

type Json = Record<string, unknown>
const fixture = (name: string) => JSON.parse(readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')) as Json

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
/** Fenced JSON examples that parse on their own and are whole commands; partial snippets are skipped. */
const commandExamples = [...guide.matchAll(/```json\n([\s\S]*?)```/gu)]
  .map(match => parsed(match[1]))
  .filter((value): value is Json => typeof value === 'object' && value !== null && 'steps' in value)

/** The code name in `column` of each body row of the first table after `heading`. */
function tableNames(heading: string, column: number): string[] {
  const lines = guide.slice(guide.indexOf(heading)).split('\n')
  const start = lines.findIndex(line => line.startsWith('|'))
  const end = lines.findIndex((line, index) => index > start && !line.startsWith('|'))
  return lines.slice(start + 2, end).map(row => /`([^`]+)`/u.exec(row.split('|')[column] ?? '')?.[1] ?? '')
}

describe('the extension guide Adapt sends', () => {
  it('shows the shipped website command exactly, after the meeting debrief example', () => {
    expect(commandExamples.map(command => command.id)).toEqual(['new-debrief', 'save-page'])
    expect(commandExamples[1]).toEqual((fixture('website-capture.json').commands as Json[])[0])
  })

  it('has examples that validate, derive their exact capabilities and review honestly on today\'s hosts', () => {
    const outcomes = commandExamples.map((command, index) => {
      const base = fixture(index === 0 ? 'meeting-debrief.json' : 'website-capture.json')
      const result = parseExtensionPackage(JSON.stringify({ ...base, commands: [command] }))
      if (result.status !== 'valid') throw new Error(JSON.stringify(result.diagnostics))
      const review = reviewPackage(result.extension, E2_HOST_CAPABILITIES)
      return { capabilities: result.extension.capabilities, activation: review.activation, missing: review.missing, network: review.commands[0].network }
    })
    expect(outcomes).toEqual([
      { capabilities: ['document.create', 'document.open'], activation: 'available', missing: [], network: 'none' },
      { capabilities: ['document.create', 'document.open', 'web.capture'], activation: 'blocked', missing: ['web.capture'], network: 'explicitWebPage' },
    ])
    expect(E1_HOST_CAPABILITIES).not.toContain('web.capture')
  })

  it('lists exactly the step operations and capabilities, in their canonical order', () => {
    expect(tableNames('## Steps', 2)).toEqual([...STEP_OPERATIONS])
    expect(tableNames('## Capabilities', 1)).toEqual([...CAPABILITIES])
  })
})
