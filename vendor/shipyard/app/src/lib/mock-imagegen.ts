import dawn from "@/components/art/backgrounds/dawn.webp";

// The demo's image generator: Codex, signed in, that "draws" for a few
// seconds and hands back the dawn harbour. ?imagegen=missing or
// ?imagegen=signedout shows the other states.

export function imageGenCall(method: string, path: string, delay: <T>(v: T) => Promise<T>): Promise<unknown> | undefined {
  if (path !== "/v1/imagegen") return undefined;
  const state = new URLSearchParams(location.search).get("imagegen");
  if (method === "GET") {
    const installed = state !== "missing";
    const signedIn = installed && state !== "signedout";
    return delay({
      generators: [
        {
          id: "codex",
          name: "Codex",
          installed,
          signed_in: signedIn,
          path: installed ? "/opt/homebrew/bin/codex" : undefined,
          note: !installed ? "Install Codex's CLI (brew install codex) and sign in with `codex login`, then check again." : !signedIn ? "Run `codex login` in a terminal, then check again." : undefined,
          command: [installed ? "/opt/homebrew/bin/codex" : "codex", "exec", "--ephemeral", "--skip-git-repo-check", "--json", "--sandbox", "read-only", "--cd", "<an empty temporary folder>", "{prompt}"],
        },
      ],
    });
  }
  if (method === "POST") {
    return (async () => {
      await new Promise((r) => setTimeout(r, 3000));
      const blob = await (await fetch(dawn)).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { mime: "image/webp", data: btoa(bin), prompt: "a calm harbour at dawn" };
    })();
  }
  return undefined;
}
