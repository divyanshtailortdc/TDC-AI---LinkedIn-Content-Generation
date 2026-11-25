import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Browser } from "./browser.ts";
import type { Smoothness, Stage } from "./stage.ts";

// Finds what would make a recording choppy before you record: a busy computer,
// a development build, or a page that can't scroll smoothly.

/** The finished video is 30 fps, so a second below this repeats frames. */
const MIN_FPS = 30;
/** A wait this long is a visible freeze. Shorter ones hide in a scroll's slow start. */
const MAX_GAP_MS = 300;
/** A program above this share of one core competes with the recording. */
const BUSY_CPU = 40;

export const isSmooth = (s: Smoothness) => s.worstFps >= MIN_FPS && s.longestGapMs <= MAX_GAP_MS;

export const smoothText = (s: Smoothness) =>
  `worst second ${s.worstFps} fps at ${s.worstAt.toFixed(1)}s, longest gap ${s.longestGapMs} ms`;

/** Programs using the most CPU now, summed by name. Empty on Windows. */
function busyPrograms() {
  if (process.platform === "win32") return [];
  const r = spawnSync("ps", ["-Ao", "pcpu=,comm="], { encoding: "utf8" });
  const totals = new Map<string, number>();
  for (const line of (r.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*([\d.]+)\s+(.+)$/);
    if (!match) continue;
    const name = path.basename(match[2].trim());
    totals.set(name, (totals.get(name) ?? 0) + Number(match[1]));
  }
  return [...totals]
    .filter(([, cpu]) => cpu >= BUSY_CPU)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cpu]) => ({ name, cpu: Math.round(cpu) }));
}

function lowPowerMode() {
  if (process.platform !== "darwin") return false;
  const r = spawnSync("pmset", ["-g"], { encoding: "utf8" });
  return /lowpowermode\s+1/.test(r.stdout ?? "");
}

const DEV_BUILD = `Boolean(document.querySelector("nextjs-portal, script[src*='@vite/client'], script[src*='webpack-hmr']"))`;

/** What to fix on this computer. Call it before starting the recording browser, which would count as busy. */
export function machineFixes() {
  const fixes = busyPrograms().map(
    (p) => `Quit or pause ${p.name} (${p.cpu}% CPU): it takes processor time from the recording.`,
  );
  if (lowPowerMode()) fixes.push("Turn off Low Power Mode: it slows the processor during recording.");
  return fixes;
}

/**
 * Scroll-tests each page, prints a JSON report and returns true when nothing
 * needs fixing. `visit` opens a page the way a recording would. `fixes` starts
 * with what `machineFixes` found.
 */
export async function preflight({
  page,
  stage,
  pages,
  dir,
  fixes,
  visit,
}: {
  page: Browser;
  stage: Stage;
  pages: string[];
  dir: string;
  fixes: string[];
  visit: (pathname: string) => Promise<void>;
}) {
  const results = [];
  let devBuild = false;
  for (const pathname of pages) {
    await visit(pathname);
    devBuild ||= await page.eval<boolean>(DEV_BUILD);
    await stage.inject({ cursor: false });
    await page.eval(`__pv.curtain.remove(), true`);
    await stage.record(path.join(dir, "trial"));
    await stage.scroll(500, 1600);
    await stage.scroll(-500, 1600);
    const { smoothness } = await stage.stop();
    results.push({ path: pathname, smooth: isSmooth(smoothness), ...smoothness });
    if (isSmooth(smoothness)) continue;
    fixes.push(
      smoothness.pageFreezeMs > MAX_GAP_MS
        ? `${pathname} blocks its own page for ${smoothness.pageFreezeMs} ms. Wait for that work to finish in prepare, or avoid it in the scene.`
        : `${pathname} captures unevenly (${smoothText(smoothness)}) while the page itself stays free. Close other programs and let the computer cool down.`,
    );
  }
  if (devBuild)
    fixes.unshift("Record a production build: development builds compile on demand and block the page.");

  console.log(
    JSON.stringify(
      {
        pages: results,
        fixes,
        verdict: fixes.length ? "Fix these before recording." : "Ready to record.",
      },
      null,
      2,
    ),
  );
  return fixes.length === 0;
}
