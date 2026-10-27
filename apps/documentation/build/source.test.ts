import path from 'node:path';
import url from 'node:url';
import { resolveConfig } from 'vite';
import { beforeAll, describe, expect, test } from 'vitest';
import { highlight } from './markdown.ts';
import { source } from './source.ts';

// Load the grammars before the tests compare highlighted output.
beforeAll(async () => {
  await highlight('const value = 1;', 'ts');
}, 30_000);

type Load = (id: string) => Promise<string>;

const documentation = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/** What `?source` or `?excerpt` hands the page for one file: its text, and that text highlighted. */
async function load(file: string, query: string): Promise<{ text: string; html: string }> {
  const module = await (source().load as Load)(`${path.join(documentation, file)}${query}`);
  const value = (name: string) =>
    JSON.parse(new RegExp(`^export const ${name} = (.*);$`, 'm').exec(module)![1]!) as string;
  return { text: value('text'), html: value('html') };
}

describe("an example's source", () => {
  test('is highlighted as a code block in a page is', async () => {
    const { text, html } = await load('src/examples/fitness.ts', '?source');
    expect(html).toBe(await highlight(text, 'ts'));
  });

  test('is highlighted in the language its excerpt names', async () => {
    const { text, html } = await load('src/examples/settings.ts', '?excerpt');
    expect(html).toBe(await highlight(text, 'html'));
  });
});

describe('a file outside what the server may read', () => {
  test('is refused, as Vite refuses a request for it', async () => {
    const plugin = source();
    const config = await resolveConfig({ root: documentation, configFile: false }, 'serve');
    (plugin.configResolved as (config: unknown) => void)(config);
    const outside = path.join(path.parse(documentation).root, 'etc', 'hosts');
    await expect((plugin.load as Load)(`${outside}?source`)).rejects.toThrow(/may not read/);
  });
});
