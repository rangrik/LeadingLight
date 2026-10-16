import { createContext, useContext } from 'react'

/** The current pane's existing Markdown page, bound before opening its folder picker. */
export const PageRelocationContext = createContext<((returnFocus: HTMLElement | null) => void) | null>(null)
export const usePageRelocationAction = () => useContext(PageRelocationContext)
