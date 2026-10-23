import { toastManager } from "@/components/ui/toast";

// copyText puts text on the clipboard and says so. Where the clipboard API
// is refused (an old webview, an unfocused page) it falls back to a hidden
// textarea and the system copy command.
export async function copyText(text: string, what = "Copied"): Promise<boolean> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(ta);
    ta.select();
    ok = document.execCommand("copy");
    ta.remove();
  }
  toastManager.add(ok ? { type: "success", title: what } : { type: "error", title: "Couldn't copy", description: "The clipboard refused it." });
  return ok;
}
