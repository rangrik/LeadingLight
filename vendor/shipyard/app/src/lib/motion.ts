// Motion the app starts from script: a smooth scroll is a jump when the
// person asked macOS to reduce motion (index.css stills CSS animations).

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// scrollBehavior is what scrollIntoView and scrollTo should use.
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? "auto" : "smooth");
