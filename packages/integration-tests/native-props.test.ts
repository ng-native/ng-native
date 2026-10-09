/**
 * A misspelt input or attribute on a host primitive.
 *
 * `<text [numberofLines]="2">` binds no input, so Angular hands it to the renderer as a property,
 * and the engine sent it to native as a prop no view reads. Angular's own "Can't bind to" check
 * needs a DOM, so nothing said so. In development the engine compares a primitive's props with
 * what its component declares and reports the rest, once per element and prop.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { WRITTEN_PROPS } from '../components/src/written-props.ts';
import { compileFixture } from './compile.ts';

describe('a prop the native view does not declare', () => {
  let mod: Record<string, unknown>;
  const warnings: string[] = [];
  const warn = console.warn;

  before(async () => {
    mod = await compileFixture('fixtures/native-props.ts');
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  });

  after(() => {
    console.warn = warn;
  });

  afterEach(() => {
    cleanup();
    warnings.length = 0;
  });

  const said = () => warnings.filter((line) => line.includes('has no prop'));

  it('is reported in development, once per element and name, with the name it meant', async () => {
    await render(mod['MisspeltProps'] as Type<unknown>, { dev: true });
    const reports = said();
    assert.equal(reports.length, 3, reports.join('\n'));
    assert.match(reports[0]!, /<text> has no prop 'numberofLines'.*Did you mean 'numberOfLines'/);
    assert.match(reports[1]!, /<view> has no prop 'backgroundcolor'/);
    assert.match(reports[2]!, /<switch> has no prop 'iosBackgroundColor'/);
  });

  it('says nothing of style, events, accessibility, pass-through props or directive inputs', async () => {
    await render(mod['DeclaredProps'] as Type<unknown>, { dev: true });
    assert.deepEqual(said(), []);
  });

  it('says nothing in a release build', async () => {
    await render(mod['MisspeltProps'] as Type<unknown>, { dev: false });
    assert.deepEqual(said(), []);
  });

  it('knows every prop the components write that is not an input of theirs', () => {
    // A host binding or a write from code under the native view's own name. Missing one here
    // would make a correct template report its own component.
    const dir = fileURLToPath(new URL('../components/src/', import.meta.url));
    const written = new Set(WRITTEN_PROPS);
    const missing: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.includes('generated')) continue;
      const source = readFileSync(dir + file, 'utf8');
      const names = [
        ...source.matchAll(/^\s+'\[([a-zA-Z_]+)\]':/gm),
        ...source.matchAll(/setProp\((?:this\.node|node), '([a-zA-Z_]+)'/g),
        ...source.matchAll(/write\('([a-zA-Z_]+)'/g),
      ].map((match) => match[1]!);
      for (const name of names) {
        if (!written.has(name) && !['style', 'styleOverride', 'intrinsicSize'].includes(name)) {
          missing.push(`${file}: ${name}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
