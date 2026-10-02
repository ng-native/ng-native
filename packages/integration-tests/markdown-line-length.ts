/**
 * Finds prose and front-matter `summary:` lines over 100 columns, in the two places
 * `docs/README.md` says Markdown goes for app authors and for npm: every page under
 * `apps/documentation/src/content`, and every `README.md` directly inside a `packages` directory.
 * Used by `markdown-line-length.test.ts`.
 *
 * `docs/README.md` states a 100-column limit, but Prettier only wraps what it parses as code, not
 * prose, so nothing enforces it there. A table, a fenced code block, a front-matter line other than
 * `summary`, and a line that is a single token (a bare URL, for instance, which cannot be wrapped)
 * are all excluded, because none of those can be rewrapped to fit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const LIMIT = 100;

export interface LineLengthViolation {
  readonly file: string;
  readonly line: number;
  readonly length: number;
  readonly kind: 'prose' | 'summary';
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...markdownFiles(full));
    } else if (entry.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/** The repository root's `apps/documentation/src/content` pages, and every package's README. */
export function markdownTargets(repoRoot: string): string[] {
  const files = markdownFiles(path.join(repoRoot, 'apps/documentation/src/content'));
  const packagesDir = path.join(repoRoot, 'packages');
  for (const entry of readdirSync(packagesDir)) {
    const readme = path.join(packagesDir, entry, 'README.md');
    try {
      if (statSync(readme).isFile()) files.push(readme);
    } catch {
      // No README for this package.
    }
  }
  return files;
}

/** True for a markdown table row. `docs/README.md` has no table-rewrap story, so these stay out. */
function isTableLine(line: string): boolean {
  return line.trimStart().startsWith('|');
}

/**
 * A line that is one token end to end - a bare URL, a long path - cannot be wrapped shorter, and
 * neither can a list item or quote whose content is one.
 */
function isSingleToken(line: string): boolean {
  const content = line.trim().replace(/^(?:[-*+]|\d+[.)]|>)\s+/, '');
  return content.split(/\s+/).length <= 1;
}

/** Where `findLongLines` is as it walks the file, line by line. */
interface WalkState {
  /** The marker the open code fence began with, ``` or ~~~, which alone closes it. */
  fence: string | null;
  inFrontMatter: boolean;
}

/**
 * Whether the line opens or closes front matter or is inside it, and so takes no prose rule. Only an
 * over-length `summary:` there is a violation, answered as `summary`.
 */
function frontMatter(
  line: string,
  number: number,
  state: WalkState,
): 'summary' | 'skip' | undefined {
  const trimmed = line.trim();
  if (number === 1 && trimmed === '---') {
    state.inFrontMatter = true;
    return 'skip';
  }
  if (!state.inFrontMatter) return undefined;
  if (trimmed === '---') state.inFrontMatter = false;
  else if (trimmed.startsWith('summary:') && line.length > LIMIT) return 'summary';
  return 'skip';
}

/** Whether the line opens or closes a code fence; only the marker that opened one closes it. */
function fenceEdge(trimmed: string, state: WalkState): boolean {
  const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
  if (!marker || (state.fence !== null && !marker.startsWith(state.fence))) return false;
  state.fence = state.fence === null ? marker.slice(0, 3) : null;
  return true;
}

/** The violation on one line, or undefined if the line is exempt or within the limit. */
function checkLine(
  line: string,
  number: number,
  state: WalkState,
): LineLengthViolation['kind'] | undefined {
  const matter = frontMatter(line, number, state);
  if (matter) return matter === 'summary' ? 'summary' : undefined;
  if (fenceEdge(line.trim(), state)) return undefined;
  if (state.fence !== null || isTableLine(line) || isSingleToken(line)) return undefined;
  return line.length > LIMIT ? 'prose' : undefined;
}

/** Every line in `text` over the limit, excluding what cannot or need not be rewrapped. */
export function findLongLines(file: string, text: string): LineLengthViolation[] {
  const violations: LineLengthViolation[] = [];
  const state: WalkState = { fence: null, inFrontMatter: false };

  text.split('\n').forEach((line, index) => {
    const number = index + 1;
    const kind = checkLine(line, number, state);
    if (kind) violations.push({ file, line: number, length: line.length, kind });
  });

  return violations;
}

export function findAllLongLines(repoRoot: string): LineLengthViolation[] {
  const violations: LineLengthViolation[] = [];
  for (const file of markdownTargets(repoRoot)) {
    violations.push(...findLongLines(path.relative(repoRoot, file), readFileSync(file, 'utf8')));
  }
  return violations;
}
