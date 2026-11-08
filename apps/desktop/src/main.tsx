import React from "react";
import ReactDOM from "react-dom/client";
import App from './App';
import { BrowserAddressEntry } from './components/browser-migration';
import "./styles.css";
import { platformReady } from "./lib/platform";

document.documentElement.dataset.authorship = localStorage.getItem("leadinglight.authorship") || "false";

// Dev only: ?demo's fixed runtime answers before anything asks the runtime (qa/demo/seed.js).
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has("demo")
  ? import(/* @vite-ignore */ String("/qa/demo/seed.js")).then((m) => m.installFixture())
  : undefined;

void Promise.all([platformReady, demo]).then(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserAddressEntry><App /></BrowserAddressEntry>
  </React.StrictMode>,
));

if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || ["127.0.0.1", "localhost"].includes(location.hostname))) {
  void navigator.serviceWorker.register("/sw.js").catch(console.error);
}
