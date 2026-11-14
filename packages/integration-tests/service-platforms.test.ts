/**
 * The "Platforms" line on each service's documentation page. The site writes it from the service's
 * row in `OS_SUPPORT` (`<!-- platforms: Service -->`), so these tests hold the pages to the table:
 * a page for a service with a row carries the marker, a marker names only services with a row, and
 * every service the table lists has a page that says so.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OS_SUPPORT, platformsLine, supportRowOf } from '@ng-native/device';

const content = new URL('../../apps/documentation/src/content/packages/', import.meta.url);

interface Page {
  readonly path: string;
  readonly body: string;
  readonly marked: readonly string[];
}

function pages(): Page[] {
  return ['device', 'expo'].flatMap((dir) =>
    readdirSync(fileURLToPath(new URL(`${dir}/`, content)))
      .filter((file) => file.endsWith('.md'))
      .map((file) => {
        const path = `${dir}/${file}`;
        const body = readFileSync(fileURLToPath(new URL(path, content)), 'utf8');
        const marked = [...body.matchAll(/^<!-- platforms: ([\w, ]+) -->$/gm)].flatMap((m) =>
          m[1]!.split(',').map((name) => name.trim()),
        );
        return { path, body, marked };
      }),
  );
}

const listed = OS_SUPPORT.flatMap((row) => [
  ...Object.keys(row.services ?? {}),
  ...(row.inert ?? []),
]);

describe('the platforms line on service pages', () => {
  it('is on a page for every service the table lists', () => {
    assert.ok(listed.length >= 10, `the table lists ${listed.length} services`);
    const marked = new Set(pages().flatMap((page) => page.marked));
    assert.deepEqual(
      listed.filter((name) => !marked.has(name)),
      [],
    );
  });

  it('names only services that have a row', () => {
    const unknown = pages().flatMap((page) =>
      page.marked.filter((name) => !supportRowOf(name)).map((name) => `${page.path}: ${name}`),
    );
    assert.deepEqual(unknown, []);
  });

  it('says what the row says: present where it is not absent, absent where it is', () => {
    for (const name of listed) {
      const row = supportRowOf(name)!;
      const line = platformsLine(name)!;
      const [available = '', absent = ''] = line.replace('**Platforms.** ', '').split('Absent on ');
      for (const [os, cell] of Object.entries(row.on)) {
        const label = {
          macos: 'macOS',
          ipados: 'iPadOS',
          iphone: 'iPhone',
          android: 'Android',
          web: 'Web host',
        }[os]!;
        const inAvailable = new RegExp(`\\b${label}\\b`).test(available);
        const inAbsent = new RegExp(`\\b${label}\\b`).test(absent.split(', where')[0]!);
        assert.equal(inAvailable, cell !== 'absent', `${name} on ${os}`);
        assert.equal(inAbsent, cell === 'absent', `${name} on ${os}`);
      }
    }
  });

  it('is only written by the marker: no page spells the line out', () => {
    const typed = pages().filter((page) => page.body.includes('**Platforms.**'));
    assert.deepEqual(
      typed.map((page) => page.path),
      [],
    );
  });
});
