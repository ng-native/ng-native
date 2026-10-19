/**
 * What a run is said to have found: the expectations a later run is compared with, the pass
 * rate of each suite, and the failures gathered by cause, the most common first.
 */
import { createHash } from 'node:crypto';

const passedOf = (result) => result.subtests.filter((test) => test.status === 'PASS');

/** A file's result as the expectations keep it: its status, its counts, and which passed. */
export function expectationOf(result) {
  const passed = passedOf(result).map((test) => test.name);
  const digest = createHash('sha1').update(passed.sort().join('\n')).digest('hex').slice(0, 10);
  const total = result.subtests.length;
  return {
    status: result.status,
    pass: passed.length,
    fail: total - passed.length,
    total,
    passed: digest,
  };
}

/** The expectations as the file holds them: a line a file, in order, so a change reads as one. */
export function writeExpectations(commit, files) {
  const lines = Object.keys(files)
    .sort()
    .map((path) => `    ${JSON.stringify(path)}: ${JSON.stringify(files[path])}`);
  return `{\n  "commit": ${JSON.stringify(commit)},\n  "files": {\n${lines.join(',\n')}\n  }\n}\n`;
}

/**
 * How a file's subtests differ from what was recorded. How the file ended is not compared: a file
 * that passes nothing ends OK on one run and TIMEOUT on the next as it lands either side of its
 * time limit. A file that stops early loses the subtests after where it stopped, which is seen.
 */
function change(path, was, now) {
  if (!was) return { path, kind: 'new' };
  const worse = now.pass < was.pass || (now.pass === was.pass && now.passed !== was.passed);
  if (worse) return { path, kind: 'failing', was, now };
  if (now.pass > was.pass) return { path, kind: 'passing', was, now };
  // As many passing, the same ones, and more or fewer subtests failing.
  return now.total === was.total ? undefined : { path, kind: 'changed', was, now };
}

/**
 * What `--check` makes of a run's changes: `worse`, the files that pass less than recorded or
 * were not run, and `unrecorded`, those that pass more, are new, or have more or fewer subtests. Either
 * fails it: an improvement not recorded with `--update` leaves the expectations stale, and a
 * later regression to where they say would pass unseen.
 */
export function verdict(changes) {
  const worse = changes.filter((each) => each.kind === 'failing' || each.kind === 'missing');
  const unrecorded = changes.filter((each) => !worse.includes(each));
  return { worse: worse.length, unrecorded: unrecorded.length };
}

/**
 * How a run differs from what was expected: files `passing` more, `failing` where they passed,
 * `changed` otherwise, `new` to the expectations, and `missing`, which were expected and not
 * run. `inScope` is whether a path is one the run was asked for: every one where every suite
 * was run, and only what a filter matches where it was not, outside which a file not run is no
 * news.
 */
export function compare(expected, results, inScope) {
  const changes = [];
  for (const [path, result] of Object.entries(results)) {
    const changed = change(path, expected[path], expectationOf(result));
    if (changed) changes.push(changed);
  }
  for (const path of Object.keys(expected)) {
    if (inScope(path) && !results[path]) {
      changes.push({ path, kind: 'missing', was: expected[path] });
    }
  }
  return changes;
}

/** What is called on, without the name a test happened to give what it was called on. */
function member(expression) {
  const parts = expression.split('.');
  const name = parts.at(-1);
  if (parts.length === 1) return name;
  const known = /^(document|window|self|ctx|canvas|Object|Array|Node|Element|Event)$/;
  const on = parts.at(-2);
  return known.test(on) ? `${on}.${name}` : `.${name}`;
}

/** An assertion's failure, by which assertion and how it failed, not by the values it compared. */
function assertion(kind, rest) {
  const threw = /threw object "([^"]*)"/.exec(rest);
  if (threw) return `${kind}: threw the wrong error: ${causeOf(threw[1])}`;
  if (/did not throw/.test(rest)) return `${kind}: did not throw`;
  const got = /but got (?:\([a-z]+\) )?(undefined|null|NaN)\b/.exec(rest);
  if (got) return `${kind}: got ${got[1]}`;
  const typed = /expected \(([a-z]+)\) .* but got \(([a-z]+)\)/.exec(rest);
  if (typed) return `${kind}: expected a ${typed[1]}, got a ${typed[2]}`;
  return `${kind}: wrong value`;
}

/**
 * Where an error was thrown, for one thrown by the package or the engine under it and not by
 * the test: the function and the file, which is where the gap is.
 */
function thrownIn(stack) {
  const frame = /^\s*at (?:(\S+) \()?file:\S*\/packages\/([\w-]+)\/src\/([\w.-]+):\d+/m.exec(
    (stack ?? '').split('\n').slice(0, 2).join('\n'),
  );
  if (!frame) return '';
  const [, name, project, file] = frame;
  return ` [thrown in ${project}/${file}${name ? ` ${name.replace(/^Object\./, '')}` : ''}]`;
}

const CAUSES = [
  [/([\w$.]+) is not a function/, (m) => `${member(m[1])} is not a function`],
  [/([\w$.]+) is not a constructor/, (m) => `${member(m[1])} is not a constructor`],
  [/([\w$.]+) is not iterable/, (m) => `${member(m[1])} is not iterable`],
  [
    /Cannot (read|set) properties of (undefined|null) \((?:reading|setting) '([^']+)'\)/,
    (m) =>
      `Cannot ${m[1]} properties of ${m[2]} (${m[1] === 'read' ? 'reading' : 'setting'} '${m[3]}')`,
  ],
  [
    /Cannot destructure property '([^']+)' of '[^']*' as it is (undefined|null)/,
    (m) => `Cannot read properties of ${m[2]} (reading '${m[1]}')`,
  ],
  [/([\w$]+) is not defined/, (m) => `${m[1]} is not defined`],
  [/Right-hand side of 'instanceof' is not (callable|an object)/, (m) => m[0]],
  [
    /Cannot (?:use 'in' operator|convert undefined or null)[^"]*/,
    (m) => m[0].replace(/'[^']*' in .*/, "'x' in y"),
  ],
  [/Maximum call stack size exceeded/, (m) => m[0]],
  // A test fetching a file beside it: there is no page URL to resolve one against, and no server.
  [/Failed to parse URL from \S+/, () => 'fetch of a relative URL: Failed to parse URL'],
  [/^(assert_\w+): ?(.*)$/s, (m) => assertion(m[1], m[2])],
];

/**
 * The cause a failure's message names, as the group it is counted in.
 *
 * One is named by where it was thrown: the harness prints an element it is about to say was
 * the wrong one by its `attributes`, and where there are none it throws instead, and the
 * assertion that failed is not what the test reports.
 */
export function causeOf(message, stack, ids = []) {
  if (message == null || message === '') return 'no message';
  const missing = /([\w$]+) is not defined/.exec(message);
  if (missing && ids.includes(missing[1])) {
    return "an element's id is not a property of window (named access): X is not defined";
  }
  if (/reading 'length'/.test(message) && /^\s*at format_value/m.test(stack ?? '')) {
    return 'an assertion failed on an element the harness could not print: .attributes is undefined';
  }
  for (const [pattern, name] of CAUSES) {
    const found = pattern.exec(message);
    if (found) return name(found) + thrownIn(stack);
  }
  const rejected = /Unhandled rejection with value: object "(.*)"$/s.exec(message);
  if (rejected) return `unhandled rejection: ${causeOf(rejected[1])}`;
  // Anything else by its words, without what differs from one test to the next.
  return message
    .replace(/"[^"]*"|'[^']*'/g, "'..'")
    .replace(/\d+/g, 'N')
    .slice(0, 90);
}

/** Every failure of a run, one for a subtest and one for a file that did not run to its end. */
function* failures(results) {
  for (const [path, result] of Object.entries(results)) {
    const ids = result.namedAccess ?? [];
    if (result.status !== 'OK') {
      const message = result.message ?? '';
      // A file that stopped for a cause is counted with the subtests that failed for it.
      const cause = message ? causeOf(message, undefined, ids) : `file ${result.status}`;
      yield { path, cause, message: `(file ${result.status}) ${message}` };
    }
    for (const message of result.pageErrors ?? []) {
      yield { path, cause: `page not built: ${causeOf(message)}`, message };
    }
    for (const test of result.subtests) {
      if (test.status === 'PASS') continue;
      const cause =
        test.message == null ? `subtest ${test.status}` : causeOf(test.message, test.stack, ids);
      yield { path, cause, message: `${test.name}: ${test.message ?? test.status}` };
    }
  }
}

/** The failures of a run by cause, the most common first. */
export function clusters(results) {
  const byCause = new Map();
  for (const { path, cause, message } of failures(results)) {
    const cluster = byCause.get(cause) ?? { cause, count: 0, files: new Set(), samples: [] };
    byCause.set(cause, cluster);
    cluster.count++;
    if (!cluster.files.has(path) && cluster.samples.length < 3) {
      cluster.samples.push(`${path}: ${message.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    cluster.files.add(path);
  }
  return [...byCause.values()].sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
}

function suiteRow(suite, results, skipped) {
  const row = { suite, run: 0, ok: 0, clean: 0, pass: 0, total: 0, skipped: 0, statuses: {} };
  for (const result of Object.values(results)) {
    if (result.suite !== suite) continue;
    const pass = passedOf(result).length;
    row.run++;
    row.statuses[result.status] = (row.statuses[result.status] ?? 0) + 1;
    row.pass += pass;
    row.total += result.subtests.length;
    if (result.status === 'OK' && pass > 0 && pass === result.subtests.length) row.clean++;
  }
  for (const count of Object.values(skipped[suite] ?? {})) row.skipped += count;
  return row;
}

const percent = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : '-');

function table(rows) {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => String(row[column]).length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, at) => String(cell).padEnd(widths[at]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function ratesTable(rows) {
  const head = [
    'suite',
    'files run',
    'all passing',
    'files skipped',
    'subtests passed',
    'of',
    'rate',
  ];
  const body = rows.map((row) => [
    row.suite,
    row.run,
    `${row.clean} (${percent(row.clean, row.run)})`,
    row.skipped,
    row.pass,
    row.total,
    percent(row.pass, row.total),
  ]);
  return table([head, ...body]);
}

function statusLines(rows) {
  return rows.map((row) => {
    const said = Object.entries(row.statuses)
      .sort()
      .map(([status, count]) => `${status} ${count}`);
    return `${row.suite}: ${said.join(', ') || 'nothing run'}`;
  });
}

function skipLines(suites, skipped, support) {
  const lines = [];
  for (const suite of suites) {
    const reasons = Object.entries(skipped[suite] ?? {}).sort((a, b) => b[1] - a[1]);
    lines.push(`${suite}: ${support[suite] ?? 0} support files, not tests`);
    for (const [reason, count] of reasons) lines.push(`  ${String(count).padStart(5)}  ${reason}`);
  }
  return lines;
}

function clusterLines(found, limit) {
  const lines = [];
  found.slice(0, limit).forEach((cluster, at) => {
    lines.push(
      `${String(at + 1).padStart(3)}. ${cluster.count} in ${cluster.files.size} files: ${cluster.cause}`,
    );
    for (const sample of cluster.samples) lines.push(`       ${sample}`);
  });
  return lines;
}

/**
 * The summary of a run, as text: the pass rate of each suite, what was skipped and why, and
 * the failures by cause.
 */
export function summarize({ commit, suites, results, skipped, support, filters, timeout }) {
  const rows = suites
    .map((suite) => suiteRow(suite, results, skipped))
    .filter((row) => row.run || row.skipped || support[row.suite]);
  const found = clusters(results);
  const failed = found.reduce((sum, cluster) => sum + cluster.count, 0);
  const scope = filters.length ? `only what matches: ${filters.join(' ')}` : 'every suite';
  return [
    'Web Platform Tests against @ng-native/web-compat',
    `wpt ${commit}, ${scope}, ${timeout} ms a file`,
    '',
    'PASS RATE',
    ratesTable(rows),
    '',
    '"all passing" is a file whose harness finished and every subtest passed.',
    '',
    'HOW EACH FILE ENDED',
    ...statusLines(rows),
    '',
    'SKIPPED',
    ...skipLines(
      rows.map((row) => row.suite),
      skipped,
      support,
    ),
    '',
    `FAILURES BY CAUSE (${failed} failures in ${found.length} causes; the first 60)`,
    'A failure is a subtest that did not pass, or a file that did not run to its end.',
    ...clusterLines(found, 60),
    '',
  ].join('\n');
}
