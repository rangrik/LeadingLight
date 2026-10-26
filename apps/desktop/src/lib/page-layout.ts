import { localPrefs } from "~/lib/local-prefs";

export const DEFAULT_CONTENT_WIDTH = 632;
export const contentWidth = (value: number) => Number.isFinite(value) ? Math.min(1600, Math.max(320, Math.round(value))) : DEFAULT_CONTENT_WIDTH;
const prefs = localPrefs("ll.page-layout", { width: DEFAULT_CONTENT_WIDTH, fullWidth: false });
export const usePageLayout = prefs.use;
export const setPageLayout = prefs.set;
