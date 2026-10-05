/**
 * A `.md` import under both runners: the Node hook and the Vitest plugin make the file the module
 * Metro makes of it, `{ attributes, content, tokens }`, so a test imports what the bundle has.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { ngNative } from '../runner/vitest.mjs';

const SOURCE = '---\ntitle: Hello\n---\n# Hi\n';

type Transform = (source: string, id: string) => { code: string } | null;

describe('a .md import', () => {
  it('is the module Metro makes of the file, under node --test', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-md-')));
    try {
      const file = path.join(dir, 'post.md');
      writeFileSync(file, SOURCE);
      const { default: post } = (await import(pathToFileURL(file).href)) as {
        default: { attributes: unknown; content: string; tokens: { type: string }[] };
      };
      assert.deepEqual(post.attributes, { title: 'Hello' });
      assert.equal(post.content, '# Hi\n');
      assert.equal(post.tokens[0]?.type, 'heading');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('is the same module under the Vitest plugin, and a ?raw import is left as it is', () => {
    const transform = ngNative().transform as unknown as Transform;
    const result = transform(SOURCE, '/app/src/content/post.md');
    assert.match(
      result?.code ?? '',
      /^export default JSON\.parse\('\{"attributes":\{"title":"Hello"\}/,
    );
    assert.equal(transform(SOURCE, '/app/src/content/post.md?raw'), null);
  });

  it('leaves a .md file another plugin already made a module of to that plugin', () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-md-')));
    try {
      const file = path.join(dir, 'lesson.md');
      writeFileSync(file, SOURCE);
      const transform = ngNative().transform as unknown as Transform;
      const rendered = 'export const blocks = [];\nexport default { blocks };\n';
      assert.equal(transform(rendered, file), null);
      assert.match(transform(SOURCE, file)?.code ?? '', /"title":"Hello"/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
