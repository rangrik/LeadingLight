import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Slider } from "@leadinglight/ui/components/slider";
import { cn } from "@leadinglight/ui/lib/utils";
import { cardEdge } from "./ui";

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
// Both numbers show hours once the file is an hour or longer, so they keep one shape.
const clock = (seconds: number, hours: boolean) => {
  const s = Number.isFinite(seconds) ? seconds : 0;
  const m = Math.floor((s % 3600) / 60);
  return hours ? `${Math.floor(s / 3600)}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

// Video and audio with controls built from COSS parts instead of the browser's own. `overlay`
// sits over the picture; `actions` end the controls row.
export function Player({
  kind,
  src,
  overlay,
  actions,
  onError,
}: { kind: "video" | "audio"; src: string; overlay?: ReactNode; actions?: ReactNode; onError?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const hours = duration >= 3600;

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const media = {
    ref: (el: HTMLMediaElement | null) => {
      ref.current = el;
    },
    src,
    preload: "metadata",
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setTime(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => setDuration(e.currentTarget.duration),
    onDurationChange: (e: React.SyntheticEvent<HTMLMediaElement>) => setDuration(e.currentTarget.duration),
    onVolumeChange: (e: React.SyntheticEvent<HTMLMediaElement>) => setMuted(e.currentTarget.muted),
    onError,
  };
  const toggle = () => {
    const el = ref.current;
    if (el) void (el.paused ? el.play() : el.pause());
  };

  return (
    <div className={cn("ll-player rounded-lg border", cardEdge)} ref={root}>
      {kind === "video" ? (
        <div className="relative min-h-0 flex-1">
          {/* In the page a click selects the block; in full screen it plays and pauses. */}
          <video {...media} className="ll-video" onClick={full ? toggle : undefined} playsInline />
          {/* Editing controls have no place in full screen. */}
          {!full && overlay}
        </div>
      ) : (
        <audio {...media} />
      )}
      {/* data-controls keeps ProseMirror from treating clicks and drags here as node clicks. */}
      {/* An audio card is one row, so the block handle centres on it (ll-row). */}
      <div className={cn("flex items-center gap-2 px-2 py-1.5", kind === "audio" && "ll-row")} contentEditable={false} data-controls>
        <Button aria-label={playing ? "Pause" : "Play"} onClick={toggle} size="icon-sm" variant="ghost">
          {playing ? <Pause /> : <Play />}
        </Button>
        {/* The hidden copy is as wide as the readout can get, so the slider never moves. */}
        <span className="grid shrink-0 text-muted-foreground text-xs tabular-nums">
          <span className="col-start-1 row-start-1">
            {clock(time, hours)} / {clock(duration, hours)}
          </span>
          <span aria-hidden className="invisible col-start-1 row-start-1">
            {hours ? "0:00:00 / 0:00:00" : "00:00 / 00:00"}
          </span>
        </span>
        <Slider
          className="min-w-0 flex-1 [&_[data-slot=slider-control]]:min-w-0"
          getAriaLabel={() => "Seek"}
          max={duration || 1}
          onValueChange={(value) => {
            const v = Array.isArray(value) ? value[0] : value;
            if (ref.current && Number.isFinite(v)) ref.current.currentTime = v;
          }}
          step={0.1}
          value={time}
        />
        <Button
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => ref.current && (ref.current.muted = !ref.current.muted)}
          size="icon-sm"
          variant="ghost"
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        {kind === "video" && (
          <Button
            aria-label={full ? "Exit full screen" : "Full screen"}
            // The whole player, so our controls stay instead of the browser's.
            onClick={() => void (full ? document.exitFullscreen() : root.current?.requestFullscreen())}
            size="icon-sm"
            variant="ghost"
          >
            {full ? <Minimize /> : <Maximize />}
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
