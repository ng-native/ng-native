// Records the screenshots the iOS flows compare against: `pnpm e2e:ios:record`, once the screens
// look right on the simulator. Runs a copy of each flow that asserts a screenshot, beside the
// original so its subflows resolve the same, with every `assertScreenshot` turned into a
// `takeScreenshot` of the baseline it names. The copies are removed afterwards.
//
// The committed baselines are of one simulator: another runtime draws its system font and its bars
// differently, and a fifth of each screenshot differs for that alone. To compare a change with
// main, record both builds in one sitting with `compare-builds.mjs` (or `pr-gate.mjs --app`), which
// needs no committed baseline at all.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const baselines = join(here, 'baselines');
mkdirSync(baselines, { recursive: true });

// Maestro writes screenshots only under the run's output folder; they are moved out after.
const output = join(here, '.recording');
rmSync(output, { recursive: true, force: true });
const copies = [];
const expected = new Set();
// Only the flows named, where any are: `compare-builds.mjs` records only the flows it compares.
const only = process.argv.slice(2).map((file) => resolve(file));
for (const dir of [here, join(here, 'visual')]) {
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.yaml'))) {
    if (only.length && !only.includes(join(dir, name))) continue;
    const flow = readFileSync(join(dir, name), 'utf8');
    if (!flow.includes('assertScreenshot')) continue;
    const taken = flow.replace(
      /- assertScreenshot:\n\s+path: (\S+)\.png\n(\s+thresholdPercentage: [\d.]+\n)?/g,
      (_, path) => {
        expected.add(`${basename(path)}.png`);
        return `- takeScreenshot: ${basename(path)}\n`;
      },
    );
    const copy = join(dir, name.replace(/\.yaml$/, '.recording.yaml'));
    writeFileSync(copy, taken);
    copies.push(copy);
  }
}

try {
  // On the simulator `MAESTRO_DEVICE` names, where one is: see `compare-builds.mjs`.
  const device = process.env.MAESTRO_DEVICE ? ['--device', process.env.MAESTRO_DEVICE] : [];
  // Links allowed first, which the flows that open a screen by its link expect.
  const allow = join(here, 'allow-links.yaml');
  execFileSync('maestro', [...device, 'test', '--test-output-dir', output, allow, ...copies], {
    stdio: 'inherit',
    env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21' },
  });
} finally {
  for (const copy of copies) rmSync(copy);
  for (const file of findPngs(output)) renameSync(file, join(baselines, basename(file)));
  rmSync(output, { recursive: true, force: true });
}

function findPngs(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && expected.has(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}
