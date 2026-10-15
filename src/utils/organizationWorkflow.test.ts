import { describe, expect, it } from 'vitest'
import {
  ALL_NOTES_SELECTION,
  INBOX_SELECTION,
  getDefaultSelectionForOrganization,
  isExplicitOrganizationEnabled,
  sanitizeSelectionForOrganization,
} from './organizationWorkflow'

describe('organizationWorkflow', () => {
  it('keeps unspecified organization off and starts in All Notes', () => {
    for (const setting of [undefined, null]) {
      expect(isExplicitOrganizationEnabled(setting)).toBe(false)
      expect(getDefaultSelectionForOrganization(setting)).toEqual(ALL_NOTES_SELECTION)
      expect(sanitizeSelectionForOrganization(INBOX_SELECTION, setting)).toEqual(ALL_NOTES_SELECTION)
    }
  })

  it('preserves an explicit opt-in and its Inbox selection', () => {
    expect(isExplicitOrganizationEnabled(true)).toBe(true)
    expect(sanitizeSelectionForOrganization(INBOX_SELECTION, true)).toEqual(INBOX_SELECTION)
  })

  it('treats explicit false as disabled', () => {
    expect(isExplicitOrganizationEnabled(false)).toBe(false)
  })

  it('defaults to Inbox when explicit organization is enabled', () => {
    expect(getDefaultSelectionForOrganization(true)).toEqual(INBOX_SELECTION)
  })

  it('defaults to All Notes when explicit organization is disabled', () => {
    expect(getDefaultSelectionForOrganization(false)).toEqual(ALL_NOTES_SELECTION)
  })

  it('replaces Inbox selection with All Notes when the workflow is disabled', () => {
    expect(sanitizeSelectionForOrganization(INBOX_SELECTION, false)).toEqual(ALL_NOTES_SELECTION)
  })

  it('leaves non-Inbox selections unchanged when the workflow is disabled', () => {
    const selection = { kind: 'filter', filter: 'archived' } as const
    expect(sanitizeSelectionForOrganization(selection, false)).toEqual(selection)
  })
})
