import { expect, test, type Page } from "@playwright/test";

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
});

async function addVoice(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Voice QA");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("/voice");
  await page.getByRole("option", { name: "Voice recording" }).click();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
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
