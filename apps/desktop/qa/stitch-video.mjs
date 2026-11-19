// Puts the Mac and phone recordings of one run side by side, aligned at their ends (both close together).
// Usage: node qa/stitch-video.mjs <prefix> <out.mp4>   e.g. /tmp/ll-device-qa-evidence/happy-path
import { execFileSync } from 'node:child_process';

const [prefix, out] = process.argv.slice(2);
if (!prefix || !out) throw new Error('Usage: node qa/stitch-video.mjs <prefix> <out.mp4>');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
// ffmpeg prints the duration on stderr and exits 1 when given no output.
const length = (file) => {
  let log = '';
  try { execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { log = String(e.stderr); }
  const [, h, m, s] = /Duration: (\d+):(\d+):([\d.]+)/.exec(log) ?? [];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};
const mac = `${prefix}-mac.webm`, phone = `${prefix}-phone.webm`;
const lead = Math.max(0, length(mac) - length(phone)), lag = Math.max(0, length(phone) - length(mac));
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(lead), '-i', mac, '-ss', String(lag), '-i', phone,
  '-filter_complex', '[0:v]fps=25,setsar=1[a];[1:v]fps=25,setsar=1[b];[a][b]hstack=inputs=2:shortest=1',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`wrote ${out} (mac ahead ${lead.toFixed(1)}s, phone ahead ${lag.toFixed(1)}s)`);
