import { mergeAttributes, Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import type { Asset, AssetStore } from "./assets";
import { Player } from "./player";
import { captureVoiceReview, type VoiceReview } from "./voice-review";

type VoiceOptions = { assets: AssetStore; onReview?: (review: VoiceReview) => void; onSaved?: () => void; onDetached?: (recordingId: string, asset: Asset) => Promise<void> };

type Phase = "idle" | "starting" | "recording" | "saving" | "transcribing";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const microphoneErrors: Record<string, string> = {
  NotAllowedError: "Microphone access is off. Allow LeadingLight in System Settings → Privacy & Security → Microphone, or allow this site in your browser.",
  NotFoundError: "No microphone was found. Connect a microphone and try again.",
  NotReadableError: "Your microphone could not be started. Check your input device and close other apps using it, then try again.",
};

function VoiceView({ node, editor, extension, updateAttributes, getPos }: NodeViewProps) {
  const options = extension.options as VoiceOptions;
  const assets = options.assets;
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pending = useRef<File | null>(null);
  const alive = useRef(true);
  const cancelled = useRef(false);
  const busy = useRef(false);
  const attempt = useRef(0);
  const committed = useRef<string | null>(null);
  const editable = editor.isEditable && !editor.view.dom.closest("[data-annotate]");

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (!committed.current) cancelled.current = true;
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  // Added by the capture box's mic: it records at once, and only the once. A timer, so React's
  // dev double mount starts it a single time.
  useEffect(() => {
    if (!node.attrs.autostart) return;
    const timer = window.setTimeout(() => {
      updateAttributes({ autostart: false });
      void start();
    });
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const commit = () => {
    const pos = getPos();
    if (pos === undefined || editor.isDestroyed) return;
    const current = editor.state.doc.nodeAt(pos);
    if (current?.type.name !== "voiceRecording") return;
    committed.current = crypto.randomUUID();
    // The save's identity is not a separate edit for Undo.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, recordingId: committed.current }).setMeta("addToHistory", false));
  };

  const transcribe = async (asset: Asset) => {
    setPhase("transcribing");
    try {
      if (!assets.transcribe) throw new Error("Transcription is available in the Mac app on macOS 26 or newer. Your audio is saved.");
      const text = (await assets.transcribe(asset, navigator.language)).trim();
      if (!alive.current || editor.isDestroyed) return;
      if (!text) throw new Error("No speech was found. Your audio is saved; you can retry transcription.");
      const pos = getPos();
      if (pos === undefined) return;
      const current = editor.state.doc.nodeAt(pos);
      if (current?.type.name !== "voiceRecording" || current.attrs.transcribed) return;
      const paragraphs = text.split(/\n+/).filter(Boolean).map((line) => editor.schema.nodes.paragraph.create(null, editor.schema.text(line)));
      // Undoing the transcript must keep the saved audio, even when recognition finishes at once.
      editor.view.dispatch(closeHistory(editor.state.tr)
        .setNodeMarkup(pos, undefined, { ...current.attrs, transcribed: true, transcript: text })
        .insert(pos + current.nodeSize, paragraphs));
      editor.view.dispatch(closeHistory(editor.state.tr));
    } catch (cause) {
      if (alive.current) setError(message(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPhase("idle");
    }
  };

  const save = async () => {
    const file = pending.current;
    if (!file) return;
    busy.current = true;
    setPhase("saving");
    setError("");
    try {
      const asset = await assets.put(file);
      if (!alive.current || editor.isDestroyed) {
        if (committed.current) await options.onDetached?.(committed.current, asset);
        return;
      }
      const pos = getPos();
      if (pos === undefined || editor.state.doc.nodeAt(pos)?.attrs.recordingId !== committed.current) {
        pending.current = null;
        busy.current = false;
        setPhase("idle");
        return;
      }
      updateAttributes({ src: asset.url, name: asset.name, size: asset.size, mime: asset.mime, recordingId: committed.current });
      pending.current = null;
      options.onSaved?.();
      await transcribe(asset);
    } catch (cause) {
      if (alive.current) {
        setError(`The recording could not be saved: ${message(cause)}. Keep this page open and try again.`);
        setPhase("idle");
      } else console.error("A stopped recording could not finish saving after its page closed.", cause);
      busy.current = false;
    }
  };

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    const started = ++attempt.current;
    cancelled.current = false;
    committed.current = null;
    setError("");
    setPhase("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Recording is unavailable in this browser. Open LeadingLight on your Mac.");
      }
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || cancelled.current || started !== attempt.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      capture.onerror = () => {
        if (!alive.current || started !== attempt.current) return;
        setError("The microphone stopped responding. Any audio captured so far will be saved.");
        commit();
        if (capture.state !== "inactive") capture.stop();
      };
      capture.onstop = () => {
        input.getTracks().forEach((track) => track.stop());
        if ((!alive.current && !committed.current) || cancelled.current || started !== attempt.current) return;
        if (!committed.current) commit();
        stream.current = null;
        recorder.current = null;
        const type = capture.mimeType || chunks[0]?.type || "audio/mp4";
        const blob = new Blob(chunks, { type });
        if (!blob.size) {
          setError("No audio was recorded. Check your microphone and try again.");
          setPhase("idle");
          busy.current = false;
          return;
        }
        const suffix = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        pending.current = new File([blob], `Voice ${new Date().toISOString().replace(/[:.]/g, "-")}.${suffix}`, { type });
        void save();
      };
      capture.start(1000);
      setSeconds(0);
      setPhase("recording");
    } catch (cause) {
      if (started !== attempt.current) return;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      busy.current = false;
      if (!alive.current || started !== attempt.current) return;
      setError(cause instanceof DOMException ? microphoneErrors[cause.name] ?? message(cause) : message(cause));
      setPhase("idle");
    }
  };
  const cancel = () => {
    ++attempt.current;
    cancelled.current = true;
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    busy.current = false;
    setPhase("idle");
  };

  return (
    <NodeViewWrapper className="ll-media space-y-2" data-media="voice" data-voice-id={node.attrs.recordingId ? `voice-${node.attrs.recordingId}` : undefined} contentEditable={false}>
      {node.attrs.src && <Player kind="audio" src={node.attrs.src} onError={() => setError("The saved recording cannot be played. The audio file may have been moved or deleted.")} />}
      {editable && <div className="ll-row flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" data-controls>
        <Mic className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-[min(10rem,100%)] flex-1" role="status">
          {phase === "recording" ? `Recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
            : phase === "starting" ? "Waiting for microphone…"
            : phase === "saving" ? "Saving audio…"
            : phase === "transcribing" ? "Transcribing on this Mac… The speech model may download on first use."
            : node.attrs.transcribed ? "Voice recording · transcript added below" : node.attrs.src ? "Voice recording" : "Record a voice note"}
        </span>
        {phase === "recording" && <Button size="xs" variant="outline" onClick={() => {
          commit();
          setPhase("saving");
          if (recorder.current?.state !== "inactive") recorder.current?.stop();
        }}><Square className="size-4 fill-current" />Stop and transcribe</Button>}
        {(phase === "recording" || phase === "starting") && <Button size="xs" variant="ghost" onClick={cancel}>Cancel</Button>}
        {phase === "idle" && pending.current && <Button size="xs" variant="outline" onClick={() => { if (!busy.current) void save(); }}>Save recording</Button>}
        {phase === "idle" && !pending.current && !node.attrs.src && <Button size="xs" variant="outline" onClick={() => void start()}>Record</Button>}
        {phase === "idle" && node.attrs.src && !node.attrs.transcribed && <Button size="xs" variant="outline" onClick={() => {
          if (busy.current) return;
          busy.current = true;
          setError("");
          void transcribe({ url: node.attrs.src, name: node.attrs.name, size: node.attrs.size, mime: node.attrs.mime });
        }}>Retry transcription</Button>}
        {phase === "idle" && node.attrs.transcript && options.onReview && <Button size="xs" variant="outline" onClick={() => {
          const pos = getPos();
          const review = pos === undefined ? null : captureVoiceReview(editor, pos);
          if (review) options.onReview?.(review);
        }}>Review transcript</Button>}
      </div>}
      {error && <p className="text-muted-foreground text-sm" role="alert">{error}</p>}
    </NodeViewWrapper>
  );
}

export const VoiceRecording = Node.create<VoiceOptions>({
  name: "voiceRecording",
  group: "block",
  atom: true,
  draggable: true,
  addOptions: () => ({ assets: null as unknown as AssetStore }),
  addAttributes: () => ({ src: { default: null }, name: { default: null }, size: { default: null }, mime: { default: null }, recordingId: { default: null }, transcript: { default: null }, transcribed: { default: false, parseHTML: (element) => element.getAttribute("transcribed") === "true" }, autostart: { default: false, rendered: false } }),
  parseHTML: () => [{ tag: 'div[data-voice-recording]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-voice-recording": "" }), ["audio", { src: HTMLAttributes.src, controls: "" }]],
  addNodeView: () => ReactNodeViewRenderer(VoiceView, { stopEvent: ({ event }) => !!(event.target as Element)?.closest?.("[data-controls]") }),
});
