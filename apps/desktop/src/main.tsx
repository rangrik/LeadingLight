import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { platformReady } from "./lib/platform";

void platformReady.then(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
