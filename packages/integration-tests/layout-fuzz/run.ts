/**
 * The layout fuzzer: random cases laid out by Chrome and by this project's pipeline, every box
 * compared, each failing case shrunk, and the shrunk cases grouped into ranked classes.
 *
 *   pnpm layout-fuzz [options]      (in packages/integration-tests)
 *
 *   --cases N          cases to generate (default 500, at most 5000)
 *   --seed S           first seed; case i has seed S + i (default 1)
 *   --features a,b     what the generator writes (default all; see FEATURES in generate.ts)
 *   --conformance c    strict (default: none of Yoga's legacy errata) or classic
 *   --yoga y           react-native (default: the Yoga react-native vendors, built as an addon)
 *                      or npm (yoga-layout from npm, older)
 *   --shrink N         failing cases to shrink, at most (default 200)
 *   --replay S         lay out one case and print both sides and what was committed, then stop:
 *                      a seed, or FILE#N for family N of a results file
 *   --out FILE         where to write the full results as JSON (default a temp file)
 *   --baseline FILE    a results file of a run over the same seeds with fewer features: shrink
 *                      only the cases that matched there, and count how many no longer do
 *   --yogas            compare npm's Yoga with react-native's on the cases instead of Chrome:
 *                      how many cases the two lay out differently, and the first few
 *   --force            run even when the machine is busy
 *
 * The hand-written cases in `sanity.ts` run first and must agree, or nothing else runs.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { boxes, outline, stylesheet, type Case } from './case.ts';
import { ChromeLayout } from './chrome.ts';
import { describeDifference, describeRect, differences } from './compare.ts';
import { FEATURES, generate, type Feature } from './generate.ts';
import { layOutInPipeline, type PipelineResult } from './pipeline.ts';
import { Classes, formatReport, resultsJson, tally, type Outcome } from './report.ts';
import { SANITY } from './sanity.ts';
import { shrink } from './shrink.ts';

const { values } = parseArgs({
  options: {
    cases: { type: 'string', default: '500' },
    seed: { type: 'string', default: '1' },
    features: { type: 'string', default: FEATURES.join(',') },
    conformance: { type: 'string', default: 'strict' },
    yoga: { type: 'string', default: 'react-native' },
    shrink: { type: 'string', default: '200' },
    replay: { type: 'string' },
    out: { type: 'string' },
    baseline: { type: 'string' },
    yogas: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const features = new Set(values.features.split(',').filter(Boolean) as Feature[]);
for (const feature of features) {
  if (!FEATURES.includes(feature))
    throw new Error(`no feature ${feature}: one of ${FEATURES.join(', ')}`);
}
const conformance = values.conformance === 'classic' ? 'classic' : 'strict';
const backend = values.yoga === 'npm' ? 'npm' : 'react-native';
const total = Math.min(Number(values.cases), 5000);
const firstSeed = Number(values.seed);

const load = loadavg()[0]!;
if (load > 10 && !values.force) {
  console.error(
    `the 1-minute load is ${load.toFixed(1)}; wait for it to fall under 10, or pass --force`,
  );
  process.exit(2);
}

function pipeline(test: Case): PipelineResult | { error: string } {
  try {
    return layOutInPipeline(test, conformance, backend);
  } catch (error) {
    return { error: (error as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(error) };
  }
}

const chrome = await ChromeLayout.open();
try {
  async function judge(cases: readonly Case[]): Promise<Outcome[]> {
    const ours = cases.map(pipeline);
    const theirs = await chrome.layOut(cases);
    return cases.map((test, i): Outcome => {
      const result = ours[i]!;
      if ('error' in result) return { kind: 'threw', error: result.error };
      if (result.refused.length) return { kind: 'refused', refused: result.refused };
      if (result.unmodelled.length) return { kind: 'unmodelled', props: result.unmodelled };
      const found = differences(test, theirs[i]!, result.rects);
      return found.length ? { kind: 'mismatch', differences: found } : { kind: 'match' };
    });
  }

  // The harness first: these must agree.
  const sane = await judge(Object.values(SANITY));
  const insane = Object.keys(SANITY).filter((_, i) => sane[i]!.kind !== 'match');
  if (insane.length) {
    for (const name of insane)
      console.error(
        `sanity case "${name}":`,
        JSON.stringify(sane[Object.keys(SANITY).indexOf(name)]),
      );
    throw new Error('the hand-written cases disagree: the harness is wrong, not the engine');
  }

  if (values.yogas) {
    compareYogas();
  } else if (values.replay !== undefined) {
    const [file, rank] = values.replay.split('#');
    const test: Case = rank
      ? (JSON.parse(readFileSync(file!, 'utf8')) as { families: { case: Case }[] }).families[
          Number(rank) - 1
        ]!.case
      : generate(Number(values.replay), features);
    const [outcome] = await judge([test]);
    const [rects] = await chrome.layOut([test]);
    const ours = pipeline(test);
    console.log(`${outline(test.root)}\n\n${stylesheet(test.root)}\n\n${outcome!.kind}`);
    if ('committed' in ours) console.log(`\ncommitted:\n${ours.committed}\n`);
    for (const { name } of boxes(test.root)) {
      const mine = 'rects' in ours ? ours.rects.get(name) : undefined;
      console.log(
        `${name}: Chrome ${rects!.get(name) ? describeRect(rects!.get(name)!) : '-'}, pipeline ${mine ? describeRect(mine) : '-'}`,
      );
    }
  } else {
    await fuzz(judge);
  }
} finally {
  await chrome.close();
}

async function fuzz(judge: (cases: readonly Case[]) => Promise<Outcome[]>): Promise<void> {
  const started = Date.now();
  const cases = Array.from({ length: total }, (_, i) => generate(firstSeed + i, features));
  const outcomes: Outcome[] = [];
  for (let i = 0; i < cases.length; i += 250) {
    outcomes.push(...(await judge(cases.slice(i, i + 250))));
  }
  const found = tally(cases, outcomes);

  // Shrink the failing cases, and group what they shrink to.
  const stillFails = async (candidates: readonly Case[]) =>
    (await judge(candidates)).map((o) => o.kind === 'mismatch');
  const classes = new Classes();
  // Against a baseline, what the added features broke: the cases that matched without them.
  const before = values.baseline
    ? (JSON.parse(readFileSync(values.baseline, 'utf8')) as { kinds: Record<number, string> }).kinds
    : undefined;
  const failing = cases.filter(
    (test, i) => outcomes[i]!.kind === 'mismatch' && (!before || before[test.seed] === 'match'),
  );
  if (before) {
    const matched = cases.filter((test) => before[test.seed] === 'match').length;
    console.log(
      `${failing.length} of the ${matched} cases that matched in the baseline do not now`,
    );
  }
  const limit = Number(values.shrink);
  for (const test of failing.slice(0, limit)) {
    const small = await shrink(test, stillFails);
    const [outcome] = await judge([small]);
    if (outcome!.kind === 'mismatch') classes.add(test.seed, small, outcome.differences);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const heading = `${total} cases from seed ${firstSeed} (features ${[...features].join(',')}, ${conformance}, ${backend} Yoga), ${seconds}s`;
  console.log(formatReport(heading, found, classes, Math.max(failing.length - limit, 0)));
  const out = values.out ?? join(mkdtempSync(join(tmpdir(), 'layout-fuzz-')), 'results.json');
  // Each case's outcome by seed, so two runs over the same seeds can be told apart case by case.
  const kinds = Object.fromEntries(cases.map((test, i) => [test.seed, outcomes[i]!.kind]));
  const run = { total, firstSeed, features: [...features], conformance, yoga: backend, kinds };
  writeFileSync(out, resultsJson(run, found, classes));
  console.log(`results: ${out}`);
}

/** How far npm's `yoga-layout` is from the Yoga react-native vendors, on the same cases. */
function compareYogas(): void {
  let compared = 0;
  const differing: string[] = [];
  for (let i = 0; i < total; i++) {
    const test = generate(firstSeed + i, features);
    let ours: PipelineResult;
    let theirs: PipelineResult;
    try {
      ours = layOutInPipeline(test, conformance, 'react-native');
      theirs = layOutInPipeline(test, conformance, 'npm');
    } catch {
      continue;
    }
    compared++;
    const found = differences(test, ours.rects, theirs.rects);
    if (found.length)
      differing.push(
        `seed ${test.seed}: ${describeDifference(found[0]!).replace('Chrome', 'react-native').replace('pipeline', 'npm')}`,
      );
  }
  console.log(
    `${compared} cases: npm's Yoga and react-native's lay out ${differing.length} differently`,
  );
  for (const line of differing.slice(0, 10)) console.log(`  ${line}`);
}
