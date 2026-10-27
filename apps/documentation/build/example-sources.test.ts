import path from 'node:path';
import url from 'node:url';
import { describe, expect, test } from 'vitest';
import { exampleSources } from './example-sources.ts';

type Load = (id: string) => Promise<string | undefined>;

const workspace = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..');

describe("an example app's source file", () => {
  test('is one in the app, never one a path climbs out of it to', async () => {
    const plugin = exampleSources(workspace);
    const load = (file: string) =>
      (plugin.load as Load).call(
        { addWatchFile() {} },
        `\0virtual:angular-native/example-source/wallet/${file}.highlighted`,
      );
    await expect(load('package.json')).resolves.toMatch(/^export default /);
    await expect(load('../../package.json')).rejects.toThrow(/not a source file of wallet/);
  });
});
