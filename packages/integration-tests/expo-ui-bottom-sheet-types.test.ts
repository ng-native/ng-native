/**
 * `UiBottomSheet` exists so that a template checked strictly can open a sheet: the element on its
 * own is an unknown one there, and so is each prop on it. This runs `ngc` as an app's type-check
 * does, which reads the component's own template too, since the package is source here.
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
const root = mkdtempSync(path.join(cache, 'bottom-sheet-types-'));
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
function check(template: string, imports = 'UiBottomSheet'): string {
  writeFileSync(
    path.join(root, 'page.ts'),
    `import { Component, signal } from '@angular/core';
import { UiBottomSheet, UiHost } from '@ng-native/expo/expo-ui-components';

@Component({
  selector: 'sheet-page',
  imports: [${imports}],
  template: \`${template}\`,
})
export class SheetPage {
  protected readonly open = signal(false);
  protected readonly closed = signal(0);
  protected readonly both = [UiBottomSheet, UiHost];
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

describe('a bottom sheet in a strictly checked template, through ngc', () => {
  it('is an unknown element, prop by prop, without the component', () => {
    const errors = check(
      '<ui-host><ui-bottom-sheet [isPresented]="open()" (dismiss)="open.set(false)" /></ui-host>',
      'UiHost',
    );
    assert.match(errors, /'ui-bottom-sheet' is not a known element/);
    assert.match(errors, /Can't bind to 'isPresented'/);
  });

  it('type-checks with the component, its model, its options and its output', () => {
    assert.equal(
      check(`<ui-bottom-sheet
        [(open)]="open"
        fitToContents
        [showDragIndicator]="false"
        (dismissed)="closed.set(closed() + 1)"
      />`),
      '',
    );
  });

  it('takes the detents SwiftUI has, and no other', () => {
    assert.equal(
      check(
        `<ui-bottom-sheet [(open)]="open" [detents]="['medium', 'large', { fraction: 0.4 }, { height: 320 }]" />`,
      ),
      '',
    );
    assert.match(
      check(`<ui-bottom-sheet [(open)]="open" [detents]="['small']" />`),
      /is not assignable to type/,
    );
    assert.match(
      check(`<ui-bottom-sheet [(open)]="open" [detents]="[{ fraction: '0.4' }]" />`),
      /is not assignable to type/,
    );
    assert.match(
      check(`<ui-bottom-sheet [(open)]="open" detents="medium" />`),
      /is not assignable to type/,
    );
  });

  it('refuses an input the component does not have', () => {
    assert.match(
      check('<ui-bottom-sheet [(open)]="open" [isPresented]="true" />'),
      /Can't bind to 'isPresented'/,
    );
  });
});
