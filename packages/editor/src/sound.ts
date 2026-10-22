// Kenney's "Impact Soft Medium 001" (CC0), from soundcn. Web Audio plays it with no lag.
import tapUrl from "./sounds/tap.mp3";

let ctx: AudioContext | undefined;
let buffer: Promise<AudioBuffer> | undefined;

export function tap() {
  const c = (ctx ??= new AudioContext());
  buffer ??= fetch(tapUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => c.decodeAudioData(b));
  void buffer.then((b) => {
    const source = c.createBufferSource();
    source.buffer = b;
    source.connect(c.destination);
    source.start();
  });
}
