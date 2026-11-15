// Records a short walkthrough of a running option build as a video, with a visible cursor and
// captions, plus stills: node record.mjs <steps.json>. The steps file names the port, the output
// name and a list of steps: {caption}, {click: role/name or text}, {clickAt:[x,y]}, {type}, {key},
// {hover}, {wait: ms}, {still: name}, {eval: js}. Output: media/<name>.webm, media/<name>-<still>.png.
import { chromium } from "@playwright/test";
import { readFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = new URL("./media/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const W = 1440, H = 900;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: spec.colorScheme ?? "dark", recordVideo: { dir: out, size: { width: W, height: H } } });
const page = await ctx.newPage();
page.setDefaultTimeout(6000);
page.setDefaultNavigationTimeout(90000);

// A cursor and a caption bar drawn by the page itself, so the recording shows what the viewer should look at.
await page.addInitScript(() => {
  try { localStorage.setItem("ll.clis", JSON.stringify({ check: false })); } catch {}
  const ready = () => {
    if (document.getElementById("ll-cur")) return;
    const cur = document.createElement("div");
    cur.id = "ll-cur";
    cur.style.cssText = "position:fixed;z-index:2147483647;width:18px;height:18px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,200,60,.95);pointer-events:none;transform:translate(-50%,-50%);transition:left 120ms ease-out,top 120ms ease-out,transform 120ms;left:-50px;top:-50px";
    const cap = document.createElement("div");
    cap.id = "ll-cap";
    cap.style.cssText = "position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);max-width:70%;padding:10px 16px;border-radius:12px;background:rgba(20,20,24,.92);color:#f2f2f4;font:500 17px/1.35 -apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transition:opacity 200ms;pointer-events:none;text-align:center";
    document.documentElement.append(cur, cap);
    window.addEventListener("mousemove", (e) => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, true);
    window.addEventListener("mousedown", () => { cur.style.transform = "translate(-50%,-50%) scale(.7)"; }, true);
    window.addEventListener("mouseup", () => { cur.style.transform = "translate(-50%,-50%) scale(1)"; }, true);
  };
  if (document.documentElement) ready(); else document.addEventListener("DOMContentLoaded", ready);
  window.__caption = (text) => { ready(); const c = document.getElementById("ll-cap"); c.textContent = text; c.style.opacity = text ? "1" : "0"; };
});

const sleep = (ms) => page.waitForTimeout(ms);
const caption = async (text) => { await page.evaluate((t) => window.__caption?.(t), text); };
const target = (step) => {
  const n = step.nth ?? 0;
  // within: the row that holds some text, so a button can be found by its row.
  const base = step.within ? target(step.within).locator("xpath=..") : page;
  if (step.role) return base.getByRole(step.role, { name: step.name, exact: step.exact ?? false }).nth(n);
  if (step.text) return base.getByText(step.text, { exact: step.exact ?? false }).nth(n);
  if (step.selector) return base.locator(step.selector).nth(n);
  throw new Error("step needs role+name, text or selector: " + JSON.stringify(step));
};
const moveTo = async (loc) => {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error("no box for " + JSON.stringify(loc));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  return box;
};

await page.goto(`http://127.0.0.1:${spec.port}/?mac&demo`, { waitUntil: "load", timeout: 45000 }).catch(async (e) => { console.error("load wait failed, going on:", String(e.message).split("\n")[0]); await page.goto(`http://127.0.0.1:${spec.port}/?mac&demo`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {}); });
await sleep(spec.settle ?? 7000);
await page.waitForLoadState("networkidle").catch(() => {});
await sleep(800);
await page.mouse.move(W / 2, H / 2, { steps: 5 });

for (const step of spec.steps) {
  try {
    if (step.caption !== undefined) { await caption(step.caption); await sleep(step.hold ?? 1600); continue; }
    if (step.wait) { await sleep(step.wait); continue; }
    if (step.still) { await page.screenshot({ path: `${out}${spec.name}-${step.still}.png`, animations: "disabled" }); continue; }
    if (step.eval) { await page.evaluate(step.eval); await sleep(step.after ?? 600); continue; }
    if (step.key) { await page.keyboard.press(step.key); await sleep(step.after ?? 700); continue; }
    if (step.type) { await page.keyboard.type(step.type, { delay: 45 }); await sleep(step.after ?? 600); continue; }
    if (step.clickAt) { await page.mouse.move(step.clickAt[0], step.clickAt[1], { steps: 18 }); await sleep(250); await page.mouse.click(step.clickAt[0], step.clickAt[1]); await sleep(step.after ?? 900); continue; }
    if (step.hover) { await moveTo(target(step.hover)); await sleep(step.after ?? 900); continue; }
    if (step.click) { const loc = target(step.click); await moveTo(loc); await sleep(250); await loc.click({ modifiers: step.modifiers }); await sleep(step.after ?? 1100); continue; }
    if (step.scroll) { await page.mouse.wheel(0, step.scroll); await sleep(step.after ?? 800); continue; }
  } catch (e) {
    console.error("step failed:", JSON.stringify(step), String(e.message).split("\n")[0]);
    if (step.required) throw e;
  }
}
await caption("");
await sleep(600);
const video = page.video();
await ctx.close();
const path = await video.path();
renameSync(path, `${out}${spec.name}.webm`);
await browser.close();
console.log("saved", `${out}${spec.name}.webm`, readdirSync(out).filter((f) => f.startsWith(spec.name)).join(" "));
