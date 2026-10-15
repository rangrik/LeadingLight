import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWelcome } from './LocalWelcome'

vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: vi.fn() }),
}))

function welcomeProps() {
  return {
    mode: 'welcome' as const,
    onCreateEmptyVault: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onOpenFolder: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    creatingAction: null as 'template' | 'empty' | null,
    error: null as string | null,
  }
}

describe('LocalWelcome', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts a fresh local workspace through the existing empty-vault action', async () => {
    const props = welcomeProps()
    render(<LocalWelcome {...props} />)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create local workspace' })))

    expect(props.onCreateEmptyVault).toHaveBeenCalledOnce()
    expect(props.onOpenFolder).not.toHaveBeenCalled()
  })

  it('opens an existing folder through the existing folder action', async () => {
    const props = welcomeProps()
    render(<LocalWelcome {...props} />)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open a folder' })))

    expect(props.onOpenFolder).toHaveBeenCalledOnce()
    expect(props.onCreateEmptyVault).not.toHaveBeenCalled()
  })

  it('keeps both actions disabled while the native folder action is pending', async () => {
    let finishOpening: (() => void) | undefined
    const props = welcomeProps()
    props.onOpenFolder.mockImplementation(() => new Promise<void>((resolve) => { finishOpening = resolve }))
    render(<LocalWelcome {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open a folder' }))

    expect(screen.getByRole('button', { name: 'Opening folder…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create local workspace' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Choose the folder you want to open.')

    await act(async () => finishOpening?.())
    expect(screen.getByRole('button', { name: 'Open a folder' })).toBeEnabled()
  })

  it('uses the real creation state to prevent duplicate actions', () => {
    render(<LocalWelcome {...welcomeProps()} creatingAction="empty" />)

    expect(screen.getByRole('button', { name: 'Creating workspace…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open a folder' })).toBeDisabled()
  })

  it('shows a rejected operation and retries that same action', async () => {
    const props = welcomeProps()
    props.onOpenFolder.mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValue(undefined)
    render(<LocalWelcome {...props} />)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open a folder' })))

    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(props.onOpenFolder).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows registration errors from onboarding and retries the attempted create action', async () => {
    const props = welcomeProps()
    const { rerender } = render(<LocalWelcome {...props} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create local workspace' })))

    rerender(<LocalWelcome {...props} error="Could not register the new vault: read-only folder" />)

    expect(screen.getByRole('alert')).toHaveTextContent('read-only folder')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(props.onCreateEmptyVault).toHaveBeenCalledTimes(2)
    expect(props.onOpenFolder).not.toHaveBeenCalled()
  })

  it('identifies a missing folder while keeping both recovery actions available', () => {
    render(<LocalWelcome {...welcomeProps()} mode="vault-missing" missingPath="/tmp/synthetic-workspace" />)

    expect(screen.getByText('Workspace folder not found')).toBeInTheDocument()
    expect(screen.getByText('/tmp/synthetic-workspace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create local workspace' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open a folder' })).toBeEnabled()
  })

  it('places keyboard focus on the primary local action', () => {
    render(<LocalWelcome {...welcomeProps()} />)

    expect(screen.getByRole('button', { name: 'Create local workspace' })).toHaveFocus()
  })
})
