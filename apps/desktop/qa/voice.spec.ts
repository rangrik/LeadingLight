import { expect, test, type Page } from "@playwright/test";

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
});

async function addVoice(page: Page, words?: string) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Voice QA");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  if (words) {
    await page.keyboard.type(words);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("/voice");
  await page.getByRole("option", { name: "Voice recording" }).click();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
}

async function holdVoiceSave(page: Page) {
  await page.evaluate(() => {
    const assets = (window as any).__editor.extensionManager.extensions.find((e: any) => e.name === "voiceRecording").options.assets;
    const put = assets.put.bind(assets);
    assets.put = async (file: File) => {
      await new Promise<void>((resolve) => { (window as any).__resumeVoiceSave = resolve; });
      return put(file);
    };
  });
}

// Seam: MediaRecorder's asynchronous stop and asset persistence; catches lost audio on transcription failure.
test("voice audio survives unavailable transcription and reload", async ({ page }) => {
  await addVoice(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect(page.getByRole("alert")).toContainText("Transcription requires the Mac app");
  const audio = page.locator('[data-media="voice"] audio');
  await expect(audio).toHaveAttribute("src", /^data:audio\//);
  await page.screenshot({ path: "qa/.results-voice/voice-recording.png" });
  await page.waitForTimeout(800);
  await page.reload();
  await expect(audio).toHaveAttribute("src", /^data:audio\//);
  await expect(page.getByRole("button", { name: "Retry transcription" })).toBeVisible();
});

// Seam: permission denial and cancellation must release capture without a document change.
test("voice handles permission denial and cancellation", async ({ page }) => {
  await addVoice(page);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const failures = ["NotAllowedError", "NotFoundError", "NotReadableError"];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const failure = failures.shift();
      if (failure) throw new DOMException("QA fixture: microphone failure", failure);
      const stream = await original(constraints);
      (window as any).__voiceStream = stream;
      return stream;
    };
  });
  for (const explanation of ["Microphone access is off", "Connect a microphone", "Check your input device"]) {
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(explanation);
  }
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__voiceStream.getTracks().every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
  await expect(page.locator('[data-media="voice"] audio')).toHaveCount(0);
});

// Seam: retry results must insert beside the recording, not overwrite where the user is now typing.
test("voice inserts a retried transcript once beside its retained audio", async ({ page }) => {
  await addVoice(page);
  await page.evaluate(() => {
    const voice = (window as any).__editor.extensionManager.extensions.find((extension: any) => extension.name === "voiceRecording");
    let tries = 0;
    voice.options.assets.transcribe = async () => {
      if (++tries === 1) throw new Error("QA fixture: speech model unavailable");
      return "This is the explicit QA transcript fixture.";
    };
  });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect(page.getByRole("alert")).toContainText("QA fixture");
  await page.getByRole("button", { name: "Retry transcription" }).click();
  await expect(page.getByRole("textbox", { name: "Page body" }).locator("p").filter({ hasText: "This is the explicit QA transcript fixture." })).toHaveCount(1);
  await expect(page.locator('[data-media="voice"] audio')).toHaveAttribute("src", /^data:audio\//);
  await expect(page.getByRole("button", { name: "Retry transcription" })).toHaveCount(0);
});

// Seam: a failed disk write must retain the stopped recording for a retry.
test("voice retries saving the same audio after storage fails", async ({ page }) => {
  await addVoice(page);
  await page.evaluate(() => {
    const assets = (window as any).__editor.extensionManager.extensions.find((extension: any) => extension.name === "voiceRecording").options.assets;
    const put = assets.put.bind(assets);
    let tries = 0;
    assets.put = async (file: File) => {
      if (++tries === 1) throw new Error("QA fixture: disk full");
      return put(file);
    };
  });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect(page.getByRole("alert")).toContainText("disk full");
  await expect(page.locator('[data-media="voice"] audio')).toHaveCount(0);
  await page.getByRole("button", { name: "Save recording", exact: true }).click();
  await expect(page.locator('[data-media="voice"] audio')).toHaveAttribute("src", /^data:audio\//);
  await expect(page.getByRole("alert")).toContainText("Your audio is saved");
});

// Seam: a stopped take outlives its editor, without replacing words written after it closes.
for (const from of ["page", "closed page", "capture"] as const) test(`stopped audio survives leaving the ${from} during saving`, async ({ page }) => {
  if (from !== "capture") await addVoice(page, "Earlier paragraph.");
  else {
    await page.goto("/");
    await page.getByRole("button", { name: "Quick capture", exact: true }).click();
  }
  await holdVoiceSave(page);
  if (from === "closed page") await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module to the regression browser.
    const { objects } = await import("/src/lib/objects.ts");
    const update = objects.update.bind(objects);
    objects.update = async (id: string, patch: any) => {
      if (patch.content) await new Promise((resolve) => setTimeout(resolve, 1000));
      return update(id, patch);
    };
  });
  await page.getByRole("button", { name: from === "capture" ? "Record a voice note" : "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resumeVoiceSave)).toBe("function");
  let caret = 0;
  if (from === "page") {
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Voice QA", exact: true }).click();
    await page.getByRole("textbox", { name: "Page body" }).locator("p").last().click();
    await page.keyboard.type("Words added after stopping.");
    await page.getByRole("textbox", { name: "Page body" }).locator("p").first().click();
    await page.keyboard.press("Meta+ArrowLeft");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => (window as any).__editor.state.selection.from)).toBe(6);
    caret = await page.evaluate(() => (window as any).__editor.state.selection.from);
  } else if (from === "closed page") {
    await page.getByRole("button", { name: "Today", exact: true }).click();
  } else {
    await page.getByRole("dialog", { name: "New idea", exact: true }).getByRole("textbox", { name: "Idea", exact: true }).press("Escape");
    await expect(page.getByRole("dialog", { name: "New idea", exact: true })).toBeHidden();
  }
  await page.evaluate(() => (window as any).__resumeVoiceSave());
  if (from === "closed page") {
    await expect.poll(() => page.evaluate(async () => {
      // @ts-expect-error Vite serves this source module to the regression browser.
      const { space } = await import("/src/lib/space.ts");
      // @ts-expect-error Vite serves this source module to the regression browser.
      const { objects } = await import("/src/lib/objects.ts");
      const id = space.get().pages.find((p: any) => p.title === "Voice QA").id;
      return (await objects.get(id)).content?.content?.find((node: any) => node.type === "voiceRecording")?.attrs?.src;
    })).toMatch(/^data:audio\//);
    await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Voice QA", exact: true }).click();
  }
  if (from === "capture") await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Voice recording", exact: true }).click();
  await expect(page.locator('[data-media="voice"] audio')).toHaveAttribute("src", /^data:audio\//);
  await expect(page.getByRole("button", { name: "Retry transcription", exact: true })).toBeVisible();
  if (from === "page") {
    const body = page.getByRole("textbox", { name: "Page body" });
    await expect(body).toContainText("Words added after stopping.");
    expect(await page.evaluate(() => (window as any).__editor.state.selection.from)).toBe(caret);
    await page.keyboard.type("X");
    await expect(body.locator("p").first()).toHaveText("EarliXer paragraph.");
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Meta+z");
    await expect(page.locator('[data-media="voice"] audio')).toHaveAttribute("src", /^data:audio\//);
  }
});

// Seam: replacing a mounted take during its save must drop the old file and release its controls.
test("a replaced recording returns to idle without attaching the old audio", async ({ page }) => {
  await addVoice(page);
  await holdVoiceSave(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resumeVoiceSave)).toBe("function");
  await page.evaluate(() => {
    const editor = (window as any).__editor;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild.attrs, recordingId: "replacement" }));
    (window as any).__resumeVoiceSave();
  });
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  await expect(page.locator('[data-media="voice"] audio')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save recording", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

// Seam: overlapping closed-page reads must not let one recording overwrite another's audio.
test("two detached audio saves keep both takes and the latest words", async ({ page }) => {
  await page.goto("/");
  const saved = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module to the regression browser.
    const { saveVoice } = await import("/src/lib/capture.ts");
    // @ts-expect-error Vite serves this source module to the regression browser.
    const { createPage } = await import("/src/lib/space.ts");
    // @ts-expect-error Vite serves this source module to the regression browser.
    const { objects } = await import("/src/lib/objects.ts");
    const doc = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Keep the latest words." }] },
      ...["take-a", "take-b"].map((recordingId) => ({ type: "voiceRecording", attrs: { recordingId } })),
    ] };
    const made = await createPage({ title: "Two stopped takes", content: doc });
    const get = objects.get.bind(objects);
    objects.get = async (id: string) => {
      const snapshot = await get(id);
      if (id === made.id) await new Promise((resolve) => setTimeout(resolve, 50));
      return snapshot;
    };
    try {
      await Promise.all(["take-a", "take-b"].map((recordingId) => saveVoice(made.id, recordingId, {
        url: `data:audio/wav;name=${recordingId};base64,UklGRg==`, name: `${recordingId}.wav`, mime: "audio/wav", size: 4,
      })));
      return (await get(made.id)).content;
    } finally { objects.get = get; }
  });
  expect(saved.content[0].content[0].text).toBe("Keep the latest words.");
  expect(saved.content.slice(1).map((node: any) => node.attrs.src)).toEqual([
    "data:audio/wav;name=take-a;base64,UklGRg==", "data:audio/wav;name=take-b;base64,UklGRg==",
  ]);
});

// Seam: attaching after deletion must not replace even the unchanged editor state or its history.
test("a deleted stopped take leaves the current caret and history alone", async ({ page }) => {
  await addVoice(page);
  await page.evaluate(() => {
    const editor = (window as any).__editor;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { recordingId: "deleted-take" }));
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep this newer wording." }] }] });
    editor.commands.setTextSelection(8);
  });
  await expect(page.locator('[data-media="voice"]')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module to the regression browser.
    const { saveVoice } = await import("/src/lib/capture.ts");
    // @ts-expect-error Vite serves this source module to the regression browser.
    const { space } = await import("/src/lib/space.ts");
    const id = space.get().pages.find((page: any) => page.title === "Voice QA").id;
    const editor = (window as any).__editor;
    const before = editor.state;
    await saveVoice(id, "deleted-take", { url: "data:audio/wav;base64,UklGRg==", name: "stopped.wav", mime: "audio/wav", size: 4 });
    return editor.state === before;
  })).toBe(true);
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("Keep this newer wording.");
  await expect(page.locator('[data-media="voice"]')).toHaveCount(0);
});

// Seam: fast transcription must not join the audio save into the same undo step.
test("voice undo keeps audio when transcription completes immediately", async ({ page }) => {
  await addVoice(page);
  await page.evaluate(() => {
    const voice = (window as any).__editor.extensionManager.extensions.find((extension: any) => extension.name === "voiceRecording");
    voice.options.assets.transcribe = async () => "Immediate QA transcript.";
  });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  const transcript = page.getByRole("textbox", { name: "Page body" }).locator("p").filter({ hasText: "Immediate QA transcript." });
  const audio = page.locator('[data-media="voice"] audio');
  await expect(transcript).toHaveCount(1);
  await transcript.click();
  await page.keyboard.press("Meta+z");
  await expect(transcript).toHaveCount(0);
  await expect(audio).toHaveAttribute("src", /^data:audio\//);
  await expect(page.getByRole("button", { name: "Retry transcription" })).toBeVisible();
  await page.keyboard.press("Meta+Shift+z");
  await expect(transcript).toHaveCount(1);
  await expect(audio).toHaveAttribute("src", /^data:audio\//);
});

// Seam: editor word wrapping must not squeeze a recording label between its controls.
test("voice controls wrap below a readable status in a narrow pane", async ({ page }) => {
  await addVoice(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const status = page.locator('[data-media="voice"] [role="status"]');
  await expect(status).toContainText("Recording ·");
  const label = await status.boundingBox();
  const block = await page.locator('[data-media="voice"] [data-controls]').boundingBox();
  expect(label!.height).toBeLessThanOrEqual(24);
  for (const name of ["Stop and transcribe", "Cancel"]) {
    const control = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(control!.y).toBeGreaterThan(label!.y);
    expect(control!.x).toBeGreaterThanOrEqual(block!.x);
    expect(control!.x + control!.width).toBeLessThanOrEqual(block!.x + block!.width);
  }
  await page.screenshot({ path: "qa/.results-voice-narrow/voice-narrow-fixed.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
