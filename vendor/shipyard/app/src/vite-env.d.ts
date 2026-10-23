/// <reference types="vite/client" />

// True in the live demo build (vite build --mode demo), false otherwise;
// replaced at build time, so the demo's code drops out of the app.
declare const __BERTH_DEMO__: boolean;

// The checkout's short commit hash at build time (vite.config.ts), or "".
declare const __BERTH_COMMIT__: string;

// app/package.json's version at build time (vite.config.ts).
declare const __BERTH_VERSION__: string;
