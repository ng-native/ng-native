/**
 * Declines dependencies' install scripts in `pnpm-workspace.yaml`'s `allowBuilds`, for
 * `@ng-native/nx`'s `init` and `@ng-native/turbo`'s.
 *
 * pnpm 11 sets `strictDepBuilds` by default and refuses an install, with `ERR_PNPM_IGNORED_BUILDS`,
 * while a dependency with an install script is neither allowed nor declined there. pnpm 10.26 and
 * later read the same setting.
 */

/** @typedef {import('./workspace-globs.cjs').Files} Files */

const PNPM = 'pnpm-workspace.yaml';

/** The line ending a file uses: `\r\n` where it has one. @param {string} text */
const lineEnding = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/**
 * `allowBuilds`' entries with `name` declined, unless it is already `true` or `false`. A new entry
 * takes the indentation of the entries there are, so the mapping stays valid YAML.
 *
 * @param {string} entries
 * @param {string} name
 * @param {string} eol the file's line ending
 */
function decline(entries, name, eol) {
  const key = name.startsWith('@') ? `'${name}'` : name;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^([ \\t]+)['"]?${escaped}['"]?:[ \\t]*([^\\r\\n]*)`, 'm');
  const found = line.exec(entries);
  if (found) {
    if (/^(true|false)\b/.test(found[2])) return entries;
    return entries.replace(line, `$1${key}: false`);
  }
  const indent = /^([ \t]+)[^\s#]/m.exec(entries)?.[1] ?? '  ';
  const before = entries && !entries.endsWith('\n') ? `${entries}${eol}` : entries;
  return `${before}${indent}${key}: false${eol}`;
}

/**
 * `allowBuilds` as a block mapping, the form pnpm writes: the key alone on its line, with a comment
 * after it at most, then its entries, indented, with blank and comment lines among them. The
 * entries end at their last indented line, before any blank lines that lead to the next key. Null
 * when there is no such block.
 *
 * @param {string} yaml
 * @returns {{ head: string, entries: string, start: number, end: number } | null}
 */
function allowBuildsBlock(yaml) {
  // The key's whole line, its `\r\n` included, so that the entries start on the next line.
  const key = /^allowBuilds:[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/m.exec(yaml);
  if (!key) return null;
  const head = key[0].endsWith('\n') ? key[0] : `${key[0]}${lineEnding(yaml)}`;
  const from = key.index + key[0].length;
  let end = from;
  for (let at = from; at < yaml.length;) {
    const next = yaml.indexOf('\n', at);
    const lineEnd = next === -1 ? yaml.length : next + 1;
    const line = yaml.slice(at, lineEnd);
    if (/^[ \t]+\S/.test(line)) end = lineEnd;
    else if (!/^[ \t]*\r?\n?$/.test(line)) break;
    at = lineEnd;
  }
  return { head, entries: yaml.slice(from, end), start: key.index, end };
}

/**
 * Declines `names` in `pnpm-workspace.yaml`'s `allowBuilds`. A decision the workspace already made
 * stays, and the placeholder pnpm writes after refusing an install is settled. A workspace without
 * pnpm is left alone.
 *
 * Edited as text, so the file keeps its comments and layout. An `allowBuilds` in any form other than
 * a block mapping, such as a flow mapping, is left as it is: a second key beside it would make the
 * file invalid YAML, which pnpm refuses to read.
 *
 * @param {Files} files
 * @param {string[]} names
 * @returns {string | undefined} what to decide by hand, where the file could not be edited
 */
function declineBuilds(files, names) {
  if (!files.exists(PNPM) && !files.exists('pnpm-lock.yaml')) return undefined;
  const yaml = files.read(PNPM, 'utf-8') ?? '';
  const block = allowBuildsBlock(yaml);
  if (!block && /^allowBuilds:/m.test(yaml)) {
    return (
      `${PNPM} sets allowBuilds in a form this cannot add to. Add ` +
      `${names.map((name) => `${name}: false`).join(' and ')} to it, ` +
      'or pnpm 11 stops the install until they are decided.'
    );
  }
  // The file's own line ending on every line this writes.
  const eol = lineEnding(yaml);
  const entries = names.reduce((all, name) => decline(all, name, eol), block?.entries ?? '');
  const allowBuilds = `${block?.head ?? `allowBuilds:${eol}`}${entries}`;
  const next = block
    ? yaml.slice(0, block.start) + allowBuilds + yaml.slice(block.end)
    : [yaml.replace(/(?:\r?\n)*$/, ''), allowBuilds].filter(Boolean).join(eol + eol);
  files.write(PNPM, next);
  return undefined;
}

module.exports = { declineBuilds };
