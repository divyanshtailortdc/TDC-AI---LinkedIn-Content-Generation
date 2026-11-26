#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Checks a finished video: finds one-frame flashes, choppy motion and harsh
// brightness jumps, and writes a contact sheet to look at. Exits 1 when it
// finds a flash or choppy motion.

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("usage: node check.ts <video>");
  process.exit(1);
}

const run = (cmd: string, args: string[], cwd?: string) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd });
  if (r.error) throw new Error(`${cmd} is not installed.`);
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr.trim()}`);
  return r.stdout;
};

// ffmpeg filters treat \ : and ' in a path as syntax, so the stats file gets a
// plain name and ffmpeg runs inside the temp folder to write it
const name = `product-video-check-${path.parse(file).name.replace(/[^\w-]+/g, "-")}`;
const base = path.join(os.tmpdir(), name);
const stats = `${base}-stats.txt`;
run(
  "ffmpeg",
  [
    "-v", "error", "-i", path.resolve(file),
    "-vf", `signalstats,metadata=print:file=${name}-stats.txt`,
    "-f", "null", "-",
  ],
  os.tmpdir(),
);
const report = readFileSync(stats, "utf8");
const series = (key: string) =>
  [...report.matchAll(new RegExp(`\\.${key}=([\\d.]+)`, "g"))].map((m) => Number(m[1]));
const luma = series("YAVG");
const change = series("YDIF");
const duration = Number(
  run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
);
const fps = luma.length / duration;
const at = (i: number) => `${(i / fps).toFixed(2)}s`;

// A flash: one frame far brighter or darker than both neighbors
const FLASH = 25;
const flashes: string[] = [];
for (let i = 1; i < luma.length - 1; i++) {
  const up = luma[i] - luma[i - 1] > FLASH && luma[i] - luma[i + 1] > FLASH;
  const down = luma[i - 1] - luma[i] > FLASH && luma[i + 1] - luma[i] > FLASH;
  if (up || down) flashes.push(at(i));
}
const steps = luma
  .slice(1)
  .map((v, i) => ({ change: Math.abs(v - luma[i]), time: at(i + 1) }))
  .sort((a, b) => b.change - a.change);
const harsh = steps.filter((s) => s.change > FLASH);

// Choppy motion: repeated frames between moving ones. Every file reports a
// steady frame rate, because the export fills dropped frames with repeats.
const STILL = 0.15; // Brightness change per frame below this is compression noise
const SHORT_REPEAT = 3; // Longer holds are deliberate pauses
const CHOPPY_REPEATS = 4; // One or two in a second are stops and starts
const repeats = new Map<number, number>();
for (let i = 1, held = 0; i < change.length; i++) {
  if (change[i] <= STILL) {
    held++;
    continue;
  }
  if (held >= 1 && held <= SHORT_REPEAT && change[i - held - 1] > STILL) {
    const second = Math.floor(i / fps);
    repeats.set(second, (repeats.get(second) ?? 0) + 1);
  }
  held = 0;
}
const choppy = [...repeats]
  .filter(([, count]) => count >= CHOPPY_REPEATS)
  .map(([second]) => `${second}s`);

const sheet = `${base}-sheet.jpg`;
// Up to 25 frames, at most one a second, in a grid sized to fit them
const count = Math.min(25, Math.max(1, Math.floor(duration)));
const cols = Math.min(5, count);
run("ffmpeg", [
  "-v", "error", "-y", "-i", file,
  "-vf", `fps=${count}/${duration.toFixed(3)},scale=480:-1,tile=${cols}x${Math.ceil(count / cols)}:padding=4`,
  "-frames:v", "1", sheet,
]);

console.log(
  JSON.stringify(
    {
      file,
      seconds: Number(duration.toFixed(1)),
      frames: luma.length,
      flashes,
      choppySeconds: choppy,
      harshJumps: harsh.map((s) => `${s.time} (${s.change.toFixed(0)})`),
      largestChange: `${steps[0]?.change.toFixed(1)} at ${steps[0]?.time}`,
      contactSheet: sheet,
      verdict: flashes.length
        ? "Fix before publishing: one-frame flashes found."
        : choppy.length
          ? "Re-record the scenes at these times: motion stutters there. Typing can look choppy here and is fine."
          : harsh.length
            ? "No flashes or choppy motion. Look at the harsh jumps: hard cuts are fine, stuttering fades are not."
            : "No flashes, choppy motion or harsh jumps.",
    },
    null,
    2,
  ),
);
process.exit(flashes.length || choppy.length ? 1 : 0);
