/**
 * A widget layout is an Angular component, so `ngc` type-checks its template against its `props`
 * input and the typed `ui-*` components it imports. The app never renders it, though: the widget
 * extension does, from source. The transformer replaces `widgetLayout(Layout)` with the compiled
 * layout's source, the string `createLiveActivity` and `createWidget` take, and drops the class, so
 * the component never reaches Angular's compiler or the app's bundle.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { inlineWidgetLayouts } = require('@ng-native/metro/inline-widget-layouts.cjs') as {
  inlineWidgetLayouts(src: string, filename: string): string;
};

const FILE = '/app/src/score-activity.ts';

const HEADER = `import { Component, input } from '@angular/core';
import { font, foregroundStyle as tint } from '@expo/ui/swift-ui/modifiers';
import { UiText } from '@ng-native/expo/expo-ui-components';
import { widgetLayout } from '@ng-native/expo/live-activity';
import { createLiveActivity } from 'expo-widgets';
`;

/** A module with a layout class of `body`, written over `template`, passed to `widgetLayout`. */
function module(template: string, body = 'readonly props = input.required<{ us: string }>();') {
  return `${HEADER}
@Component({
  selector: 'score-activity',
  imports: [UiText],
  template: \`${template}\`,
})
class ScoreLayout {
  ${body}
}

export const score = createLiveActivity('Score', widgetLayout(ScoreLayout));
`;
}

/** The layout source the transform put in place of `widgetLayout(...)`. */
function layoutOf(out: string): string {
  const call = /createLiveActivity\('Score', ("(?:[^"\\]|\\.)*")\)/.exec(out);
  assert.ok(call, `widgetLayout(...) was replaced with a string:\n${out}`);
  return JSON.parse(call[1]!) as string;
}

/** Calls a layout's source with stand-ins for the extension's globals. */
function run(source: string, props: unknown, globals: Record<string, unknown> = {}): unknown {
  const all = {
    _jsx: (type: string, p: unknown) => ({ type, props: p }),
    Text: 'Text',
    ...globals,
  };
  return new Function(...Object.keys(all), `return (${source});`)(...Object.values(all))(props, {});
}

describe('inlining a widget layout', () => {
  it('replaces widgetLayout(Layout) with the compiled layout, and drops the class', () => {
    const src = module('<ui-text>Us {{ props().us }}</ui-text>');
    const out = inlineWidgetLayouts(src, FILE);
    assert.deepEqual(run(layoutOf(out), { us: '30' }), {
      type: 'Text',
      props: { children: 'Us 30' },
    });
    assert.doesNotMatch(out, /class ScoreLayout|@Component/, 'nothing left for Angular to compile');
    assert.equal(out.split('\n').length, src.split('\n').length, 'line numbers are kept');
  });

  it("calls a member that holds a modifier as the extension's modifier of that name", () => {
    const out = inlineWidgetLayouts(
      module(
        '<ui-text [modifiers]="[font({ size: 34 }), tint(ball)]">x</ui-text>',
        `readonly props = input.required<object>();
  protected readonly font = font;
  protected readonly tint = tint;
  protected readonly ball = '#d7f23c';`,
      ),
      FILE,
    );
    const modifier =
      (name: string) =>
      (...args: unknown[]) => ({ name, args });
    assert.deepEqual(
      run(
        layoutOf(out),
        {},
        { font: modifier('font'), foregroundStyle: modifier('foregroundStyle') },
      ),
      {
        type: 'Text',
        props: {
          children: 'x',
          modifiers: [
            { name: 'font', args: [{ size: 34 }] },
            { name: 'foregroundStyle', args: ['#d7f23c'] },
          ],
        },
      },
    );
  });

  it('inlines constant members: strings, numbers, booleans, null, arrays and objects of them', () => {
    const out = inlineWidgetLayouts(
      module(
        '<ui-text>{{ title }} {{ size }} {{ on }} {{ none }} {{ sets.length }} {{ theme.ink }}</ui-text>',
        `readonly props = input.required<object>();
  protected readonly title = 'Live';
  protected readonly size = -2;
  protected readonly on = true;
  protected readonly none = null;
  protected readonly sets = ['6-4', '3-6'] as const;
  protected readonly theme = { ink: '#fff' };`,
      ),
      FILE,
    );
    assert.deepEqual(run(layoutOf(out), {}), {
      type: 'Text',
      props: { children: 'Live -2 true  2 #fff' },
    });
  });

  it('passes a home-screen widget its environment input', () => {
    const out = inlineWidgetLayouts(
      module(
        '<ui-text>{{ environment().widgetFamily }}</ui-text>',
        `readonly props = input.required<object>();
  readonly environment = input.required<{ widgetFamily: string }>();`,
      ),
      FILE,
    );
    const layout = new Function('_jsx', 'Text', `return (${layoutOf(out)});`)(
      (type: string, props: unknown) => ({ type, props }),
      'Text',
    ) as (props: unknown, environment: unknown) => unknown;
    assert.deepEqual(layout({}, { widgetFamily: 'systemSmall' }), {
      type: 'Text',
      props: { children: 'systemSmall' },
    });
  });

  it('compiles one layout passed to widgetLayout twice, and drops its class once', () => {
    const src = module('<ui-text>{{ props().us }}</ui-text>').replace(
      'export const score',
      "export const again = createLiveActivity('Again', widgetLayout(ScoreLayout));\nexport const score",
    );
    const out = inlineWidgetLayouts(src, FILE);
    assert.match(out, /^import \{ Component, input \}/, 'the imports are intact');
    assert.match(out, /createLiveActivity\('Again', "function/);
    assert.deepEqual(run(layoutOf(out), { us: '30' }), { type: 'Text', props: { children: '30' } });
    assert.equal(out.split('\n').length, src.split('\n').length);
  });

  it('copies a constant without the TypeScript written inside it', () => {
    const out = inlineWidgetLayouts(
      module(
        '<ui-text>{{ sizes[0].s }}{{ sizes.length }}</ui-text>',
        `readonly props = input.required<object>();
  protected readonly sizes = [{ s: 'a' } as const, { s: \`b\` } satisfies object];`,
      ),
      FILE,
    );
    assert.doesNotMatch(layoutOf(out), /as const|satisfies/);
    assert.deepEqual(run(layoutOf(out), {}), { type: 'Text', props: { children: 'a2' } });
  });

  it('reads a .tsx module with JSX elsewhere in it', () => {
    const src = module('<ui-spacer />') + 'export const other = <view />;\n';
    assert.match(layoutOf(inlineWidgetLayouts(src, FILE.replace('.ts', '.tsx'))), /^function/);
  });

  it('rewrites widgetLayout read from a namespace import', () => {
    const src = module('<ui-spacer />')
      .replace(
        "import { widgetLayout } from '@ng-native/expo/live-activity';",
        "import * as live from '@ng-native/expo/live-activity';",
      )
      .replace('widgetLayout(ScoreLayout)', 'live.widgetLayout(ScoreLayout)');
    assert.match(layoutOf(inlineWidgetLayouts(src, FILE)), /^function/);
  });

  it('refuses a layout class the module uses elsewhere, or exports', () => {
    const used = module('<ui-spacer />') + 'export const name = ScoreLayout.name;\n';
    assert.throws(
      () => inlineWidgetLayouts(used, FILE),
      /ScoreLayout is used .*only to widgetLayout/,
    );
    const exported = module('<ui-spacer />').replace(
      'class ScoreLayout',
      'export class ScoreLayout',
    );
    assert.throws(() => inlineWidgetLayouts(exported, FILE), /ScoreLayout is exported/);
  });

  it('names a private field as what it is', () => {
    const src = module(
      '<ui-spacer />',
      'readonly props = input.required<object>();\n  #secret = 1;',
    );
    assert.throws(() => inlineWidgetLayouts(src, FILE), /#secret is private/);
  });

  it('leaves a module with no widgetLayout call as it is', () => {
    const src = "import { Component } from '@angular/core';\nexport const a = 1;\n";
    assert.equal(inlineWidgetLayouts(src, FILE), src);
  });

  it('leaves a widgetLayout that is not the one from @ng-native/expo alone', () => {
    const src = 'function widgetLayout(x) { return x; }\nexport const a = widgetLayout(1);\n';
    assert.equal(inlineWidgetLayouts(src, FILE), src);
  });

  it("names the line in the module of a template's error, not the line in the template", () => {
    const src = module('<ui-vstack>\n    <ui-toggle />\n  </ui-vstack>');
    const line = src.split('\n').findIndex((text) => text.includes('<ui-toggle />')) + 1;
    assert.throws(
      () => inlineWidgetLayouts(src, FILE),
      new RegExp(`score-activity\\.ts:${line}:5: <ui-toggle> is not a view`),
    );
  });

  it('refuses a member it cannot put in the extension, naming it and its line', () => {
    const src = module(
      '<ui-text>{{ now }}</ui-text>',
      `readonly props = input.required<object>();
  protected readonly now = Date.now();`,
    );
    const line = src.split('\n').findIndex((text) => text.includes('Date.now()')) + 1;
    assert.throws(
      () => inlineWidgetLayouts(src, FILE),
      new RegExp(`score-activity\\.ts:${line}:\\d+: .*now.*a literal or a modifier`),
    );
  });

  it('refuses an input other than props and environment', () => {
    assert.throws(
      () =>
        inlineWidgetLayouts(
          module(
            '<ui-spacer />',
            'readonly props = input.required<object>();\n  readonly size = input(1);',
          ),
          FILE,
        ),
      /size.*props and environment/,
    );
  });

  it('refuses a method, which the extension has no instance to call', () => {
    assert.throws(
      () =>
        inlineWidgetLayouts(
          module(
            '<ui-spacer />',
            'readonly props = input.required<object>();\n  label() { return 1; }',
          ),
          FILE,
        ),
      /label.*method/,
    );
  });

  it('refuses a templateUrl, since the layout is read from this file', () => {
    const src = module('').replace(/template: `[^`]*`/, "templateUrl: './score.html'");
    assert.throws(() => inlineWidgetLayouts(src, FILE), /inline template, not a templateUrl/);
  });

  it('refuses a widgetLayout of something that is not a component class in this module', () => {
    const src = `${HEADER}import { Other } from './other';\nexport const s = createLiveActivity('S', widgetLayout(Other));\n`;
    assert.throws(() => inlineWidgetLayouts(src, FILE), /Other.*@Component class in this file/);
  });
});

it('is what the Metro transformer does, leaving the app nothing of the layout but its source', () => {
  const transformer = require('@ng-native/metro/transformer.cjs') as {
    transform(params: {
      filename: string;
      src: string;
      options: { dev: boolean; platform: string };
      plugins: unknown[];
    }): { ast: object };
  };
  const generate = (require('@babel/generator') as { default: Function }).default;
  const { ast } = transformer.transform({
    filename: fileURLToPath(new URL('./score-activity.ts', import.meta.url)),
    src: module(
      '<ui-text [modifiers]="[font({ size: 34 })]">{{ props().us }}</ui-text>',
      'readonly props = input.required<{ us: string }>();\n  protected readonly font = font;',
    ),
    options: { dev: false, platform: 'ios' },
    plugins: [],
  });
  const { code } = generate(ast) as { code: string };
  assert.match(code, /createLiveActivity\)?\('Score', "function\(props,environment\)/);
  assert.doesNotMatch(code, /ScoreLayout|ɵcmp|defineComponent/, 'the class is not compiled');
  for (const unused of [
    '@expo/ui/swift-ui/modifiers',
    '@ng-native/expo/expo-ui',
    '@angular/core',
  ]) {
    assert.doesNotMatch(
      code,
      new RegExp(unused.replaceAll('/', '\\/')),
      `${unused} is not imported`,
    );
  }
});
