/**
 * The section conventions in docs/README.md, held to every page so they do not drift back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const content = path.join(import.meta.dirname, '../src/content');
const pages = (fs.readdirSync(content, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.md'))
  .map((file) => ({
    file: file.split(path.sep).join('/'),
    text: fs.readFileSync(path.join(content, file), 'utf8'),
  }));

/** A page's `##` headings, skipping fenced code. */
function sections(text: string): string[] {
  let fenced = false;
  const found: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) found.push(line.slice(3).trim());
  }
  return found;
}

/** A heading that has a settled name elsewhere, and that name. */
const RENAMED: Record<string, string> = {
  Testing: 'In a test',
  'The smallest thing that works': 'The smallest useful example',
  'Without the native module': 'Without the module',
  'Without the module installed': 'Without the module',
  API: 'Reference',
  'Setting it up': 'Setup',
  'Set up': 'Setup',
  Installing: 'Install',
};

/** The sections that close a service page, in order. Any other section comes before them. */
const TAIL: readonly RegExp[] = [
  /^On iOS$/,
  /^On Android$/,
  /^On macOS$/,
  /^On Linux$/,
  /^On macOS and Linux$/,
  /^Platform differences$/,
  /^Only on (iOS|Android)$/,
  /^Without (the module|a hinge)$/,
  /^Off a device/,
  /^On iOS, the web and Node$/,
  /^In a test$/,
  /^Working offline$/,
  /^Limits$/,
  /^Reference$/,
];
const rank = (heading: string) => TAIL.findIndex((pattern) => pattern.test(heading));

describe('page sections', () => {
  test('use the settled name for a recurring section', () => {
    const wrong = pages.flatMap(({ file, text }) =>
      sections(text)
        .filter((heading) => heading in RENAMED)
        .map((heading) => `${file}: "${heading}" is "${RENAMED[heading]}"`),
    );
    expect(wrong).toEqual([]);
  });

  test('end with Reference where a page has one', () => {
    const wrong = pages
      .filter(({ text }) => sections(text).includes('Reference'))
      .filter(({ text }) => sections(text).at(-1) !== 'Reference')
      .map(({ file }) => file);
    expect(wrong).toEqual([]);
  });

  test('close an Expo or device service page in the settled order', () => {
    const wrong = pages
      .filter(({ file }) => /^packages\/(expo|device)\//.test(file))
      .flatMap(({ file, text }) => {
        const ranks = sections(text).map(rank);
        const firstTail = ranks.findIndex((r) => r >= 0);
        const tail = firstTail < 0 ? [] : ranks.slice(firstTail);
        const ordered = tail.every((r, i) => r >= 0 && (i === 0 || r >= tail[i - 1]!));
        return ordered ? [] : [`${file}: ${sections(text).join(' | ')}`];
      });
    expect(wrong).toEqual([]);
  });

  test('fence shell commands as sh', () => {
    expect(pages.filter(({ text }) => /^```bash$/m.test(text)).map(({ file }) => file)).toEqual([]);
  });
});
