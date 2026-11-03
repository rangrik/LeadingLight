// Shipyard's syntax-color tests import the vendored module directly. Run those
// assertions against the adapter used by the desktop app's Vite/TS aliases.
import { registerHooks } from "node:module";

const test = new URL("../vendor/shipyard/app/src/lib/syntax-colors.test.ts", import.meta.url).href;
const adapter = new URL("../apps/desktop/src/lib/syntax-colors.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === test && specifier === "./syntax-colors.ts") {
      return nextResolve(adapter, context);
    }
    return nextResolve(specifier, context);
  },
});
