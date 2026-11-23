/**
 * `<modal [anchor]>` in a strictly checked template. The docs point it at "a template reference to
 * an element, or to a component such as a `<pressable>`", and a template reference types as the
 * component class, or as `HTMLElement` for an element no component claims. This runs `ngc` as an
 * app's type-check does, so each of those is checked as an app writes it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const ngc = path.join(
  path.dirname(require.resolve('@angular/compiler-cli/package.json')),
  'bundles/src/bin/ngc.js',
);

// Under this package, so the modules resolve as they do from an app, and in its node_modules, so
// lint and the type-check running beside the tests never see it.
const cache = path.join(import.meta.dirname, 'node_modules/.cache');
mkdirSync(cache, { recursive: true });
const root = mkdtempSync(path.join(cache, 'modal-anchor-types-'));
after(() => rmSync(root, { recursive: true, force: true }));

writeFileSync(
  path.join(root, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'es2022',
      module: 'preserve',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
      // What an app's `tsconfig.json` has, which is the DOM's `HTMLElement` for a plain element.
      lib: ['es2022', 'dom'],
    },
    files: ['page.ts'],
    // As `template/tsconfig.json` generates an app with.
    angularCompilerOptions: {
      strictTemplates: true,
      typeCheckHostBindings: false,
      strictDomEventTypes: false,
    },
  }),
);

/** Type-checks a page written over `template`, and answers ngc's errors, or '' for none. */
function check(template: string): string {
  writeFileSync(
    path.join(root, 'page.ts'),
    `import { Component, signal } from '@angular/core';
import { Modal, Pressable, Text${template.includes('<view') ? ', View' : ''} } from '@ng-native/components';

@Component({
  selector: 'anchor-page',
  imports: [Modal, Pressable, Text${template.includes('<view') ? ', View' : ''}],
  template: \`${template}\`,
})
export class AnchorPage {
  protected readonly open = signal(false);
}
`,
  );
  try {
    execFileSync(process.execPath, [ngc, '-p', path.join(root, 'tsconfig.json')], {
      cwd: root,
      stdio: 'pipe',
    });
    return '';
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    return `${stdout ?? ''}${stderr ?? ''}` || String(error);
  }
}

describe('a modal anchored in a strictly checked template, through ngc', () => {
  it('takes the docs example, a reference to a pressable', () => {
    assert.equal(
      check(`<pressable #filter (press)="open.set(true)"><text>Filter</text></pressable>
<modal [anchor]="filter" [visible]="open()" (requestClose)="open.set(false)"><text>x</text></modal>`),
      '',
    );
  });

  it('takes a reference through exportAs', () => {
    assert.equal(
      check(`<pressable #filter="pressable" (press)="open.set(true)"><text>Filter</text></pressable>
<modal [anchor]="filter" [visible]="open()"><text>x</text></modal>`),
      '',
    );
  });

  it('takes a reference to a view', () => {
    assert.equal(
      check(`<view #box><text>Filter</text></view>
<modal [anchor]="box" [visible]="open()"><text>x</text></modal>`),
      '',
    );
  });

  it('takes a reference to an element no component claims, which types as HTMLElement', () => {
    assert.equal(
      check(`<div #box></div>
<modal [anchor]="box" [visible]="open()"><text>x</text></modal>`),
      '',
    );
  });

  it('still refuses what is no anchor', () => {
    assert.match(
      check(`<modal [anchor]="5" [visible]="open()"><text>x</text></modal>`),
      /is not assignable to type/,
    );
  });
});
