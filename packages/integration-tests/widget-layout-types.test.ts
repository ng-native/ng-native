/**
 * A widget layout is an Angular component so that `ngc`, with the strict template checking an
 * app is generated with, checks its template: each `props()` read against the props type, and
 * each `ui-*` input against the typed component, with `@expo/ui`'s modifiers as the members that
 * hold them. A mistake fails the app's type-check, rather than drawing an error on the lock screen.
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
const root = mkdtempSync(path.join(cache, 'widget-layout-types-'));
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
    files: ['layout.ts'],
    // As `template/tsconfig.json` generates an app with.
    angularCompilerOptions: {
      strictTemplates: true,
      typeCheckHostBindings: false,
      strictDomEventTypes: false,
    },
  }),
);

/** Type-checks a layout written over `template`, and answers ngc's errors, or '' for none. */
function check(template: string, extra = ''): string {
  writeFileSync(
    path.join(root, 'layout.ts'),
    `import { Component, input } from '@angular/core';
import { font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import {
  UiButton,
  UiHStack,
  UiLink,
  UiProgress,
  UiRoundedRectangle,
  UiSpacer,
  UiText,
  UiZStack,
} from '@ng-native/expo/expo-ui-components';
import { createLiveActivity } from '@ng-native/expo/live-activity';
import type { LiveActivityFactory } from 'expo-widgets';

interface Scoreline {
  us: string;
  them: string;
  done: number;
}

@Component({
  selector: 'score-layout',
  imports: [
    UiButton,
    UiHStack,
    UiLink,
    UiProgress,
    UiRoundedRectangle,
    UiSpacer,
    UiText,
    UiZStack,
  ],
  template: \`${template}\`,
})
class ScoreLayout {
  readonly props = input.required<Scoreline>();
  protected readonly font = font;
  protected readonly foregroundStyle = foregroundStyle;
  protected readonly ball = '#d7f23c';
}

// The props type comes from the layout's props input.
export const score: LiveActivityFactory<Scoreline> = createLiveActivity('Score', ScoreLayout);
${extra}
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

describe("a widget layout's template, through ngc", () => {
  it('type-checks a layout that reads its props and calls its modifiers as they are typed', () => {
    assert.equal(
      check(`<ui-hstack spacing="4">
        <ui-text [modifiers]="[font({ size: 34, weight: 'heavy' }), foregroundStyle(ball)]">Us {{ props().us }}</ui-text>
        <ui-spacer />
        <ui-progress [value]="props().done / 4" />
      </ui-hstack>`),
      '',
    );
  });

  it('type-checks the layering, shape and link views', () => {
    assert.equal(
      check(`<ui-zstack alignment="topLeading">
        <ui-rounded-rectangle cornerRadius="16" />
        <ui-link destination="padel://score"><ui-text>{{ props().us }}</ui-text></ui-link>
      </ui-zstack>`),
      '',
    );
    assert.match(check('<ui-zstack alignment="middle" />'), /"middle"' is not assignable/);
    assert.match(check('<ui-link />'), /Required input 'destination'/);
  });

  it("type-checks a widget's buttons: a target, and the props a press changes", () => {
    assert.equal(
      check(`<ui-hstack>
        <ui-button target="us" (buttonPress)="{ us: props().us + '!' }"><ui-text>Us</ui-text></ui-button>
        <ui-button [target]="props().them" label="Them" />
      </ui-hstack>`),
      '',
    );
    assert.match(
      check('<ui-button [target]="props().done" />'),
      /'number' is not assignable to type 'string/,
    );
  });

  it('fails on a class that is not a layout, with no props input', () => {
    assert.match(
      check(
        '<ui-spacer />',
        "class Plain {}\nexport const plain = createLiveActivity('Plain', Plain);",
      ),
      /Property 'props' is missing/,
    );
  });

  it('fails on a prop the props type does not have', () => {
    assert.match(
      check('<ui-text>{{ props().score }}</ui-text>'),
      /Property 'score' does not exist/,
    );
  });

  it('fails on an input of the wrong type', () => {
    assert.match(
      check('<ui-text [text]="props().done" />'),
      /'number' is not assignable to type 'string/,
    );
  });

  it("fails on a modifier's options of the wrong type", () => {
    assert.match(
      check(`<ui-text [modifiers]="[font({ size: 'big' })]">x</ui-text>`),
      /'string' is not assignable to type 'number/,
    );
  });

  it('fails on an element the layout does not import', () => {
    assert.match(check('<ui-vstack />'), /'ui-vstack' is not a known element/);
  });
});
