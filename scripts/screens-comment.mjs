/**
 * The pull request comment on what a change does to the canary's screens: one comment, kept up to
 * date, with a section from each workflow that compares them. `screens-comment.yml` runs this
 * from the default branch, on what a pull request's run uploaded.
 *
 * What it reads came from the pull request's run, which a fork controls, so it is checked before
 * any of it reaches the comment: text is stripped of what could leave a code span or write HTML,
 * lists are capped, and an image is a PNG of a plain name and a bounded size, or is refused.
 *
 *   node scripts/screens-comment.mjs native <native-output.json>
 *       the native output's section, from `native-output.mjs diff --json`
 *   node scripts/screens-comment.mjs screenshots <dir> <url>
 *       the screenshots' section, from `compare-builds.mjs`'s report and images in <dir>, each
 *       shown from <url>/<file>
 *   node scripts/screens-comment.mjs merge <comment> <key> <section> <head>
 *       the comment's body with the section for <key> at commit <head> put in, or added
 *   node scripts/screens-comment.mjs differs <comment> <head>
 *       exits 0 where the comment shows a difference at <head>, which the `Screens` status fails on
 *   node scripts/screens-comment.mjs worth <section>...
 *       exits 0 where any section has something to show, so a comment is worth starting
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { report } from './native-output.mjs';

/** The comment's own mark, which is how it is found again. */
export const MARK = '<!-- screens-report -->';

/** The most screens and screenshots listed, and the largest image put in a comment. */
const MOST_SCREENS = 50;
const MOST_SHOTS = 60;
const LARGEST_IMAGE = 3 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A name an image is shown by: letters, digits, `.`, `_` and `-`, ending in `.png`. */
const IMAGE_NAME = /^[\w.-]{1,100}\.png$/;

/**
 * A value as the comment may show it: a string with no backtick, angle bracket or line break, cut
 * short; an object or list of such values; and nothing else.
 */
export function clean(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === 'string') return value.replace(/[`<>\r\n|]/g, ' ').slice(0, 300);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((each) => clean(each, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 200)
        .map(([key, each]) => [clean(key, depth + 1), clean(each, depth + 1)]),
    );
  }
  return null;
}

/** The native output's section, from `diff --json`: what changed, or that nothing did. */
export function nativeSection(json) {
  const { results, skipped } = clean(json) ?? {};
  if (!Array.isArray(results)) throw new Error('the native output has no list of screens');
  const screens = results
    .filter((one) => one && typeof one === 'object' && typeof one.url === 'string')
    .map((one) => ({ ...one, changes: Array.isArray(one.changes) ? one.changes : [] }));
  const changed = screens.filter((one) => one.missing || one.changes.length || one.notes?.length);
  const shown = [
    ...changed.slice(0, MOST_SCREENS),
    ...screens.filter((one) => !changed.includes(one)),
  ];
  const text = report(shown, skipped && typeof skipped === 'object' ? skipped : {});
  const more =
    changed.length > MOST_SCREENS ? `\n\nand ${changed.length - MOST_SCREENS} more screens` : '';
  return `${text}${more}`;
}

/**
 * The screenshots' section, from `compare-builds.mjs`'s `report.json`: each screenshot that differs,
 * main's beside the change's with the difference marked, from `base`.
 */
export function screenshotSection(manifest, base) {
  const { flows, compared, differ, skipped } = clean(manifest) ?? {};
  if (typeof skipped === 'string') return `### iOS screenshots\n\nNot compared: ${skipped}`;
  if (compared !== true) {
    return '### iOS screenshots\n\nNot compared: a flow failed before its screenshots, see the run.';
  }
  const shots = (Array.isArray(differ) ? differ : []).filter(
    (one) => IMAGE_NAME.test(one?.base ?? '') && IMAGE_NAME.test(one?.diff ?? ''),
  );
  if (!shots.length) {
    return `### iOS screenshots: none of ${Number(flows) || 0} flows differ\n`;
  }
  // With nowhere to show them from, the screenshots that differ by name alone.
  if (!base) {
    return [
      `### iOS screenshots: ${shots.length} differ`,
      '',
      ...shots.map((one) => `- \`${one.shot}\``),
    ].join('\n');
  }
  const lines = [
    `### iOS screenshots: ${shots.length} differ`,
    '',
    'Main on the left; the change on the right, with what differs marked.',
    '',
    '| screenshot | main | change |',
    '| --- | --- | --- |',
  ];
  for (const one of shots.slice(0, MOST_SHOTS)) {
    const image = (file) => `<img src="${base}/${file}" width="240">`;
    lines.push(`| \`${one.shot}\` | ${image(one.base)} | ${image(one.diff)} |`);
  }
  return lines.join('\n');
}

/**
 * The images in a directory that may be put in the comment: each a PNG of a plain name, of a size
 * a comment can show. Throws on any other file, so a run cannot slip one in beside them.
 */
export function images(dir) {
  // The two files beside the images that are not images: what was compared, and for which pull request.
  const files = readdirSync(dir).filter((name) => name !== 'report.json' && name !== 'pr.json');
  if (files.length > MOST_SHOTS * 2)
    throw new Error(`${files.length} images, more than a comment shows`);
  for (const name of files) {
    const file = path.join(dir, name);
    if (!IMAGE_NAME.test(name)) throw new Error(`not an image name: ${name}`);
    if (!statSync(file).isFile() || statSync(file).size > LARGEST_IMAGE) {
      throw new Error(`not an image of a size to show: ${name}`);
    }
    const head = readFileSync(file).subarray(0, PNG.length);
    if (!head.equals(PNG)) throw new Error(`not a PNG: ${name}`);
  }
  return files;
}

/** A commit, as a section records the one it is for. */
const COMMIT = /^[0-9a-f]{7,40}$/;

/**
 * A comment's body with the section for `key` in place of the one it had, or added at the end. The
 * section records the commit it is for, so a section left from an earlier push is told apart.
 */
export function merge(body, key, section, head) {
  if (!COMMIT.test(head ?? '')) throw new Error(`not a commit: ${head}`);
  const opening = new RegExp(`<!-- ${key}:start(?: [0-9a-f]+)? -->`);
  const end = `<!-- ${key}:end -->`;
  const block = `<!-- ${key}:start ${head} -->\n${section.trim()}\n${end}`;
  const current = body.includes(MARK)
    ? body
    : `${MARK}\n## What this does to the canary's screens\n`;
  const found = opening.exec(current);
  const to = current.indexOf(end);
  if (found && to > found.index) {
    return `${current.slice(0, found.index)}${block}${current.slice(to + end.length)}`;
  }
  return `${current.trimEnd()}\n\n${block}\n`;
}

/** The sections of a comment that are for `head`, by key. */
function sectionsFor(body, head) {
  const found = {};
  for (const match of body.matchAll(
    /<!-- ([\w-]+):start ([0-9a-f]+) -->\n([\s\S]*?)\n<!-- \1:end -->/g,
  )) {
    if (match[2] === head) found[match[1]] = match[3];
  }
  return found;
}

/**
 * Whether a section shows a difference, which is what starts a comment: a section that says
 * nothing changed, or that nothing could be compared, updates one already there and starts none.
 */
export const worth = (section) =>
  /^### (Native output: [1-9]\d* of \d+ screens changed|iOS screenshots: \d+ differ)/m.test(
    section,
  );

/**
 * Whether the comment shows a difference at `head`, which the `Screens` status fails on until it is
 * accepted. Only the sections for that commit count: one from an earlier push says nothing of it.
 */
export const differs = (body, head) => Object.values(sectionsFor(body, head)).some(worth);

function main([command, ...args]) {
  if (command === 'native')
    return console.log(nativeSection(JSON.parse(readFileSync(args[0], 'utf8'))));
  if (command === 'screenshots') {
    images(args[0]);
    const manifest = JSON.parse(readFileSync(path.join(args[0], 'report.json'), 'utf8'));
    return console.log(screenshotSection(manifest, args[1]));
  }
  if (command === 'merge') {
    const [comment, key, section, head] = args;
    return console.log(
      merge(readFileSync(comment, 'utf8'), key, readFileSync(section, 'utf8'), head),
    );
  }
  if (command === 'differs') {
    process.exitCode = differs(readFileSync(args[0], 'utf8'), args[1]) ? 0 : 1;
    return;
  }
  if (command === 'worth') {
    process.exitCode = args.some((file) => worth(readFileSync(file, 'utf8'))) ? 0 : 1;
    return;
  }
  console.error('Usage: screens-comment.mjs native | screenshots | merge | differs | worth');
  process.exitCode = 2;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`screens-comment: ${error.message}`);
    process.exitCode = 2;
  }
}
