import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionBarrier } from './extensionApi'
import type { Capability } from './extensionContract'
import { createExtensionController, runnableCommands, type ExtensionController, type RunnableCommand, type RegistrySnapshot } from './extensionSessionController'
import { createExtensionTransport } from './extensionTransport'

/** Thrown by a boundary whose session close native has not confirmed; the transition stays refused. */
export class ExtensionsUnsettledError extends Error {
  constructor() { super('Extension session close is not confirmed'); this.name = 'ExtensionsUnsettledError' }
}

/**
 * For leaving the workspace (switch, close): `begin` stops admissions at once and returns the
 * release; `settle` waits for native to confirm and throws when it cannot. A transition that does
 * not happen releases: once the barrier is confirmed this vault continues as a new visit with a
 * fresh session later; while it is unconfirmed the registry shows `unsettled` and nothing runs
 * until the controller's retry, or the next transition, gets native's confirmation.
 */
export interface ExtensionBoundary {
  begin(): () => void
  settle(): Promise<void>
}

/**
 * Adds the extension boundary to an existing workspace hold (backup): the hold is taken first, as
 * it may refuse; then extension admissions stop at once. Release reopens both, extensions first.
 * Call the boundary's `settle` before the held work reads the workspace, so an extension write
 * admitted earlier has landed (or the work is refused) before anything is enumerated.
 */
export function holdWithExtensions(boundary: ExtensionBoundary, hold: () => () => void): () => void {
  const release = hold()
  const reopen = boundary.begin()
  let held = true
  return () => {
    if (!held) return
    held = false
    reopen()
    release()
  }
}

export interface Extensions {
  controller: ExtensionController
  snapshot: RegistrySnapshot
  runnable: RunnableCommand[]
  boundary: ExtensionBoundary
}

/** One controller for this window; each vault visit gets its own native session, never reused by path. */
export function useExtensions({ vaultPath, ready, onUnsettled, controller: injected, hostCapabilities }: {
  vaultPath: string
  ready: boolean
  /** A transition is refused because native has not confirmed; tell the person, as other boundaries do. */
  onUnsettled?: () => void
  controller?: ExtensionController
  /** What this window performs; the controller's E1 default when absent. Read once, at first render. */
  hostCapabilities?: readonly Capability[]
}): Extensions {
  const [controller] = useState(() => injected ?? createExtensionController({ api: createExtensionTransport(), hostCapabilities }))
  const boundary = useBoundary(controller, onUnsettled)
  useLayoutEffect(() => {
    const current = controller.visit()
    if (current && current.vaultPath === vaultPath) return
    // Another vault, even one not ready yet, ends this visit; coming back later is a new one.
    if (current) controller.exit()
    if (!ready || !vaultPath) return
    controller.enter(vaultPath)
    void controller.refresh()
  }, [controller, ready, vaultPath])
  useEffect(() => () => { void controller.leave() }, [controller])

  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const runnable = useMemo(() => runnableCommands(snapshot), [snapshot])
  return { controller, snapshot, runnable, boundary }
}

function useBoundary(controller: ExtensionController, onUnsettled: (() => void) | undefined): ExtensionBoundary {
  const pending = useRef<Promise<SessionBarrier>>(Promise.resolve({ status: 'confirmed' }))
  const unsettled = useRef(onUnsettled)
  useLayoutEffect(() => { unsettled.current = onUnsettled })
  return useMemo(() => ({
    begin() {
      const barrier = controller.leave()
      pending.current = barrier
      let released = false
      return () => {
        if (released) return
        released = true
        // A transition that did not happen leaves the person here. Runs resume only past a
        // confirmed barrier; unconfirmed, the vault stays visibly blocked until its retry succeeds.
        void barrier.then(result => {
          if (result.status === 'confirmed' && controller.resume()) void controller.refresh()
        })
      }
    },
    async settle() {
      if ((await pending.current).status === 'confirmed') return
      unsettled.current?.()
      throw new ExtensionsUnsettledError()
    },
  }), [controller])
}
