/**
 * One frontmatter property value, as the pure parsers read it. It lives here, not in a component,
 * so markdown utilities stay free of UI: the collaboration server compiles them without the app's
 * React components or its `@/` alias. `Inspector` re-exports it for UI callers.
 */
export type FrontmatterValue = string | number | boolean | string[] | null
