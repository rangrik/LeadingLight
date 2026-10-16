import { createContext, useContext } from 'react'

/** Opens Earlier versions for the page in this pane; null outside a pane, which hides the action. */
export const PageHistoryActionContext = createContext<((returnFocus: HTMLElement | null) => void) | null>(null)

export const usePageHistoryAction = () => useContext(PageHistoryActionContext)
