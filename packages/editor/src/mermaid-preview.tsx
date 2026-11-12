import { useEffect, useRef, useState } from "react";

// Mermaid shares parser and theme state, so each render owns both until it finishes.
let renders = Promise.resolve();
let nextId = 0;

function palette() {
  const styles = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  // Mermaid's colour calculations need hex; our theme tokens may be OKLCH or RGB.
  const color = (token: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = styles.getPropertyValue("--background").trim();
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = styles.getPropertyValue(token).trim();
    context.fillRect(0, 0, 1, 1);
    return `#${Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    darkMode: document.documentElement.classList.contains("dark"),
    background: color("--background"),
    primaryColor: color("--muted"),
    primaryTextColor: color("--foreground"),
    primaryBorderColor: color("--muted-foreground"),
    lineColor: color("--muted-foreground"),
    secondaryColor: color("--accent"),
    tertiaryColor: color("--background"),
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

export function MermaidPreview({ source }: { source: string }) {
  const [theme, setTheme] = useState(() => JSON.stringify(palette()));
  const [result, setResult] = useState({ source: "", theme: "", svg: "", error: "" });
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(JSON.stringify(palette())));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!source.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renders = renders.then(async () => {
        if (cancelled) return;
        let host: HTMLDivElement | undefined;
        try {
          const { default: mermaid } = await import("mermaid");
          if (cancelled) return;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: "base",
            themeVariables: JSON.parse(theme),
            fontFamily: JSON.parse(theme).fontFamily,
          });
          // Measure outside the editable document so Mermaid's temporary DOM cannot change the note.
          host = document.createElement("div");
          host.style.cssText = `position:fixed;left:-100000px;top:0;width:${preview.current?.clientWidth || 600}px;visibility:hidden`;
          document.body.append(host);
          const { svg } = await mermaid.render(`ll-mermaid-${++nextId}`, source, host);
          if (!cancelled) setResult({ source, theme, svg, error: "" });
        } catch {
          if (!cancelled) setResult({ source, theme, svg: "", error: "Couldn't render this diagram. Check the Mermaid syntax above." });
        } finally {
          host?.remove();
        }
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [source, theme]);

  const current = result.source === source && result.theme === theme;
  return (
    <div ref={preview} className="ll-mermaid" contentEditable={false} role="group" aria-label="Diagram preview" tabIndex={current && result.svg ? 0 : undefined}>
      {current && result.svg ? (
        <div role="img" aria-label="Mermaid diagram" dangerouslySetInnerHTML={{ __html: result.svg }} />
      ) : (
        <div role="status" className="text-sm text-muted-foreground">
          {!source.trim() ? "Write a Mermaid diagram above, for example: flowchart LR; A --> B" : current && result.error ? result.error : "Rendering diagram…"}
        </div>
      )}
    </div>
  );
}
