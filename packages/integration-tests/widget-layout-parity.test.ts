/**
 * Parity with an app: the same `ui-text`s, rendered by Angular in an app and compiled as a widget
 * layout, show the same text. The template is read out of the fixture file, so the two cannot be
 * written differently.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { registerExpoUiViews } from '@ng-native/expo';
import { registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileWidgetLayout } = require('@ng-native/metro/widget-layout.cjs') as {
  compileWidgetLayout: (template: string, options: object) => string;
};

const FIXTURE = fileURLToPath(new URL('./fixtures/widget-layout-parity.ts', import.meta.url));

interface Fixture {
  props: { set(value: Record<string, unknown>): void };
}

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

let Parity: Type<Fixture>;
before(async () => {
  Parity = (await compileFixture(FIXTURE))['WidgetLayoutParityFixture'] as Type<Fixture>;
});

/** What each `ui-text` shows in an app, in order. */
async function inApp(props: Record<string, unknown>): Promise<string[]> {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
  const fabric = createFakeFabric();
  const app = mount(1, Parity, fabric);
  (app.componentRef.instance as Fixture).props.set(props);
  app.applicationRef.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return all(fabric.committed)
    .filter((node) => /ExpoUI_TextView$/.test(node.viewName))
    .map((node) => String(node.props['text'] ?? ''));
}

/** What each `ui-text` shows in the widget layout compiled from the fixture's `ui-vstack`. */
function inWidget(props: Record<string, unknown>): string[] {
  const vstack = /<ui-vstack>[\s\S]*<\/ui-vstack>/.exec(readFileSync(FIXTURE, 'utf8'))![0];
  const source = compileWidgetLayout(vstack, { file: FIXTURE });
  const jsx = (type: string, p: Record<string, unknown>) => ({ type, props: p });
  const layout = new Function('_jsx', 'Text', 'VStack', `return (${source});`)(
    jsx,
    'Text',
    'VStack',
  );
  const tree = layout(props, {}) as { props: { children: { props: { children?: unknown } }[] } };
  return tree.props.children.map((text) => String(text.props.children ?? ''));
}

describe('a ui-text, in an app and in a widget layout', () => {
  const cases = {
    'a match under way': { us: '30', them: '15', sets: '1-0', games: '3-2', on: false, winner: '' },
    'a match won': {
      us: '0',
      them: '0',
      sets: '2-0',
      games: '0-0',
      on: true,
      winner: 'Us',
      player: { name: 'Ana' },
      missing: null,
    },
  };
  for (const [name, props] of Object.entries(cases)) {
    it(`shows the same text, for ${name}`, async () => {
      const app = await inApp(props);
      assert.equal(app.length, 9, 'every ui-text is drawn in the app');
      assert.deepEqual(inWidget(props), app);
    });
  }
});
