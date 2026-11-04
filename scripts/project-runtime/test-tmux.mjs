// Go's test timeout skips t.Cleanup. Close only sockets beneath this runner's
// marked temporary state, including those made by the testSessions fixture.
import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createConnection } from "node:net";
import { promisify } from "node:util";

const run = promisify(execFile);

function socketIsAlive(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.setTimeout(1000, () => socket.destroy(new Error("could not check the test tmux socket")));
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (err) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") resolve(false);
      else reject(err);
    });
  });
}

export async function stopTestTmux(dir) {
  async function visit(path) {
    const st = await lstat(path);
    if (st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error("runtime test tmux directory changed; kept temporary state");
    if (st.isSocket()) {
      try { await run("tmux", ["-S", path, "kill-server"], { timeout: 2000, killSignal: "SIGKILL" }); }
      catch (err) {
        // A killed server can leave its socket file behind. Only suppress a
        // failed close when the kernel confirms there is no listener.
        if (await socketIsAlive(path)) throw err;
      }
    } else if (st.isDirectory()) {
      for (const name of await readdir(path)) {
        try { await visit(join(path, name)); }
        catch (err) { if (err.code !== "ENOENT") throw err; }
      }
    }
  }
  await visit(dir);
}
