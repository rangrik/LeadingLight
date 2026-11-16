import React from "react";
import ReactDOM from "react-dom/client";
import App from './App';
import { AccountReturn } from './components/account-return';
import { BrowserAddressEntry } from './components/browser-migration';
import "./styles.css";
import { platformReady } from "./lib/platform";

document.documentElement.dataset.authorship = localStorage.getItem("leadinglight.authorship") || "false";

void platformReady.then(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {location.pathname === '/connect/complete' ? <AccountReturn /> : <BrowserAddressEntry><App /></BrowserAddressEntry>}
  </React.StrictMode>,
));

if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || ["127.0.0.1", "localhost"].includes(location.hostname))) {
  void navigator.serviceWorker.register("/sw.js").catch(console.error);
}
