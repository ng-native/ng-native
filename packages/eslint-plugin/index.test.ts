import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import ngNative from './index.mjs';

/** Each problem in `code`, as `rule: message` at `line:column`, linted as an app's file would be. */
async function lint(code: string, filePath: string, cwd = import.meta.dirname): Promise<string[]> {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: ngNative.configs.recommended,
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => `${m.line}:${m.column} ${m.ruleId}: ${m.message}`);
}

/** `code` after ESLint's fixes, as `eslint --fix` would write it. */
async function fix(code: string, filePath: string): Promise<string> {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfigFile: true,
    overrideConfig: ngNative.configs.recommended,
    fix: true,
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result.output ?? code;
}

/** `code` with the first suggestion of each problem applied, as an editor would on request. */
async function suggest(code: string, filePath: string): Promise<string> {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfigFile: true,
    overrideConfig: ngNative.configs.recommended,
  });
  const [result] = await eslint.lintText(code, { filePath });
  const [first] = result.messages.flatMap((m) => m.suggestions ?? []);
  if (!first) return code;
  const { range, text } = first.fix;
  return code.slice(0, range[0]) + text + code.slice(range[1]);
}

const component = (template: string) =>
  `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-a', template: '${template}' })\n` +
  `export class A { go() {} }\n`;

test('a DOM event in an inline template is reported, with what to use', async () => {
  assert.deepEqual(await lint(component('<pressable (click)="go()" />'), 'a.ts'), [
    '2:55 @ng-native/no-dom-events: (click) is a DOM event and never fires on a device. ' +
      'Use (press) on a <pressable>, or <text pressable (press)="...">.',
  ]);
});

test('a key event with a key filter is the key event', async () => {
  const messages = await lint('<text-input (keydown.enter)="go()" />', 'a.html');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\(keydown\) is a DOM event/);
});

test('a window, document or body listener is reported', async () => {
  const messages = await lint(
    '<view (window:resize)="go()" (document:keydown)="go()"></view>',
    'a.html',
  );
  assert.deepEqual(messages, [
    '1:7 @ng-native/no-dom-events: (window:resize) never fires: there is no window on a device. ' +
      'Use @ng-native/device for app-wide events.',
    '1:30 @ng-native/no-dom-events: (document:keydown) never fires: there is no document on a device. ' +
      'Use @ng-native/device for app-wide events.',
  ]);
});

test('native events and outputs that share a DOM name are left alone', async () => {
  const template =
    '<pressable (press)="go()" (longPress)="go()" />' +
    '<scroll-view (scroll)="go()" (layout)="go()" />' +
    '<text-input (changeText)="go()" (focus)="go()" (blur)="go()" (keyPress)="go()" />' +
    '<ui-picker (change)="go()" /><expo-image (load)="go()" (error)="go()" />';
  assert.deepEqual(await lint(template, 'a.html'), []);
});

test("a component's own output with a DOM event's name is left alone", async () => {
  assert.deepEqual(
    await lint('<app-card (drag)="go()" (drop)="go()" (click)="go()" />', 'a.html'),
    [],
  );
});

test('a window listener on a component is still reported', async () => {
  const messages = await lint('<app-card (window:resize)="go()" />', 'a.html');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\(window:resize\) never fires/);
});

test('an Expo DOM component, which runs in a web view, is left alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-native-eslint-'));
  try {
    const file = join(dir, 'signature.ts');
    const code =
      `'use dom';\nconst title = document.title;\n` + component('<button (click)="go()"></button>');
    writeFileSync(file, code);
    assert.deepEqual(await lint(code, file, dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a DOM event or a global listener in a host object or a HostListener is reported', async () => {
  const code =
    "import { Directive, HostListener } from '@angular/core';\n" +
    "@Directive({ selector: '[a]', host: { '(click)': 'go()', '(window:resize)': 'go()', '(press)': 'go()', role: 'button' } })\n" +
    'export class A {\n' +
    "  @HostListener('keydown.enter') enter() {}\n" +
    "  @HostListener('document:scroll') scrolled() {}\n" +
    "  @HostListener('layout') laidOut() {}\n" +
    '}\n';
  const messages = await lint(code, 'a.ts');
  assert.deepEqual(
    messages
      .map((m) => m.replace(/: .*/, ''))
      .map((m, i) => `${m} ${messages[i].match(/\((\w+:)?\w+\)/)?.[0]}`),
    [
      '2:39 @ng-native/no-dom-events (click)',
      '2:58 @ng-native/no-dom-events (window:resize)',
      '4:17 @ng-native/no-dom-events (keydown)',
      '5:17 @ng-native/no-dom-events (document:scroll)',
    ],
  );
});

test('routerLink, written or bound, is reported, and nativeRouterLink is not', async () => {
  const template =
    '<pressable routerLink="/a" /><pressable [routerLink]="[\'b\']" /><pressable nativeRouterLink="/c" />';
  const messages = await lint(template, 'a.html');
  assert.deepEqual(
    messages.map((m) => m.split(': ')[0]),
    ['1:12 @ng-native/no-dom-events', '1:41 @ng-native/no-dom-events'],
  );
  assert.match(messages[0], /Use nativeRouterLink from @ng-native\/router/);
});

test('an HTML control in a template is reported, with what to use', async () => {
  assert.deepEqual(await lint('<view><button>Save</button><img src="a.png" /></view>', 'a.html'), [
    '1:7 @ng-native/no-html-controls: <button> draws as a plain view on a device, with no ' +
      'behaviour. Use <pressable>.',
    '1:28 @ng-native/no-html-controls: <img> draws as a plain view on a device, with no ' +
      'behaviour. Use <image>.',
  ]);
});

test('an element nothing draws is reported as empty', async () => {
  assert.deepEqual(await lint('<video></video>', 'a.html'), [
    '1:1 @ng-native/no-html-controls: <video> draws as an empty view on a device: nothing in ' +
      'Angular Native draws it.',
  ]);
});

test("HTML's text and layout elements are left alone", async () => {
  assert.deepEqual(
    await lint('<div><p>One <strong>two</strong></p><section></section></div>', 'a.html'),
    [],
  );
});

test('a browser package, a browser-only import and a browser global are reported', async () => {
  const code =
    "import { BrowserModule } from '@angular/platform-browser';\n" +
    "import { trigger } from '@angular/animations/browser';\n" +
    "import { HttpClient, provideHttpClient } from '@angular/common/http';\n" +
    "localStorage.setItem('a', document.title);\n";
  assert.deepEqual(await lint(code, 'a.ts'), [
    '1:31 @ng-native/no-browser-apis: @angular/platform-browser needs a browser. Use mount() from @ng-native/platform.',
    '2:25 @ng-native/no-browser-apis: @angular/animations needs a browser. Use CSS transitions, or the animations in @ng-native/components.',
    '3:22 @ng-native/no-browser-apis: provideHttpClient from @angular/common/http needs a browser. ' +
      'Use provideNativeHttpClient() from @ng-native/platform/http.',
    '4:1 @ng-native/no-browser-apis: localStorage is undefined on a device. Use expo-sqlite/kv-store or another native store.',
    '4:27 @ng-native/no-browser-apis: document is undefined on a device. Use the native elements, and a template reference for a node.',
  ]);
});

test('a browser global the config declares is still reported', async () => {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfigFile: true,
    overrideConfig: [
      ...ngNative.configs.recommended,
      { languageOptions: { globals: { document: 'readonly' } } },
    ],
  });
  const [result] = await eslint.lintText('document.title;\n', { filePath: 'a.ts' });
  assert.deepEqual(
    result.messages.map((m) => m.ruleId),
    ['@ng-native/no-browser-apis'],
  );
});

test('a name the file declares, and window, are not browser globals', async () => {
  const code = 'const document = { title: "" };\nwindow.setTimeout(() => document.title);\n';
  assert.deepEqual(await lint(code, 'a.ts'), []);
});

test('(click) on a pressable is fixed to (press), in an inline template too', async () => {
  assert.equal(
    await fix('<pressable (click)="go()" /><text pressable (click)="go()">a</text>', 'a.html'),
    '<pressable (press)="go()" /><text pressable (press)="go()">a</text>',
  );
  assert.equal(
    await fix(component('<touchable-opacity (click)="go()" />'), 'a.ts'),
    component('<touchable-opacity (press)="go()" />'),
  );
});

test('(click) is not fixed where $event changes meaning or nothing presses', async () => {
  const code =
    '<pressable (click)="go($event)" /><view (click)="go()"></view><text (click)="go()">a</text>';
  assert.equal(await fix(code, 'a.html'), code);
});

test('(input) on a text input is suggested as (changeText), not fixed', async () => {
  const code = '<text-input (input)="typed($event)" />';
  assert.equal(await fix(code, 'a.html'), code);
  assert.equal(await suggest(code, 'a.html'), '<text-input (changeText)="typed($event)" />');
});

test('provideHttpClient is suggested as provideNativeHttpClient, import and calls', async () => {
  const alone =
    "import { provideHttpClient } from '@angular/common/http';\n" +
    'export const providers = [provideHttpClient()];\n';
  assert.equal(
    await suggest(alone, 'a.ts'),
    "import { provideNativeHttpClient } from '@ng-native/platform/http';\n" +
      'export const providers = [provideNativeHttpClient()];\n',
  );
});

test('provideHttpClient beside other names leaves them their import', async () => {
  const code =
    "import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';\n" +
    'export const providers = [provideHttpClient(withFetch())];\n';
  assert.equal(
    await suggest(code, 'a.ts'),
    "import { HttpClient, withFetch } from '@angular/common/http';\n" +
      "import { provideNativeHttpClient } from '@ng-native/platform/http';\n" +
      'export const providers = [provideNativeHttpClient(withFetch())];\n',
  );
});

test('provideHttpClient last among its names takes the comma before it', async () => {
  const code =
    "import { HttpClient, provideHttpClient } from '@angular/common/http';\nprovideHttpClient();\n";
  assert.equal(
    await suggest(code, 'a.ts'),
    "import { HttpClient } from '@angular/common/http';\n" +
      "import { provideNativeHttpClient } from '@ng-native/platform/http';\nprovideNativeHttpClient();\n",
  );
});

test('an uppercase element is reported and fixed to its lowercase name, both tags', async () => {
  assert.deepEqual(await lint('<View><Text>a</Text><ScrollView /></View>', 'a.html'), [
    '1:1 @ng-native/lowercase-elements: <View> matches no component and fails the build. Write <view>.',
    '1:7 @ng-native/lowercase-elements: <Text> matches no component and fails the build. Write <text>.',
    '1:21 @ng-native/lowercase-elements: <ScrollView> matches no component and fails the build. Write <scroll-view>.',
  ]);
  assert.equal(
    await fix('<View><Text>a</Text><ScrollView /></View>', 'a.html'),
    '<view><text>a</text><scroll-view /></view>',
  );
});

test("a DOM member read off a nativeElement is reported, and the node's own are not", async () => {
  const code =
    'export class A {\n' +
    '  go(ref: any) {\n' +
    '    ref.nativeElement.focus();\n' +
    "    ref.nativeElement.classList.add('on');\n" +
    '    ref.nativeElement.props;\n' +
    '  }\n' +
    '}\n';
  assert.deepEqual(await lint(code, 'a.ts'), [
    '3:23 @ng-native/no-dom-node-access: nativeElement is a native node, not a DOM element: it has no focus. ' +
      'Use focus() on the TextInput, from viewChild(TextInput).',
    '4:23 @ng-native/no-dom-node-access: nativeElement is a native node, not a DOM element: it has no classList. ' +
      'Use a binding in the template: [class.name], [style.name] or an input.',
  ]);
});

test('zone.js and provideZoneChangeDetection are reported', async () => {
  const code = "import 'zone.js';\nimport { provideZoneChangeDetection } from '@angular/core';\n";
  const messages = await lint(code, 'a.ts');
  assert.equal(messages.length, 2);
  assert.match(messages[0], /zone\.js needs a browser/);
  assert.match(messages[1], /provideZoneChangeDetection from @angular\/core/);
});

test("window's and globalThis's browser members are reported, and React Native's are not", async () => {
  const code =
    "window.addEventListener('resize', () => {});\n" +
    "globalThis.localStorage.getItem('a');\n" +
    'const w = window.innerWidth;\n' +
    'window.setTimeout(() => {});\n' +
    'requestAnimationFrame(() => window.requestAnimationFrame);\n';
  assert.deepEqual(
    (await lint(code, 'a.ts')).map((m) => m.split(' is ')[0]),
    [
      '1:1 @ng-native/no-browser-apis: window.addEventListener',
      '2:1 @ng-native/no-browser-apis: globalThis.localStorage',
      '3:11 @ng-native/no-browser-apis: window.innerWidth',
    ],
  );
});

test('every hyphenated element in @ng-native/components has its DOM events read', async () => {
  // The rule leaves another hyphenated element's events alone, so a component missing from its
  // list would have (click) pass without a word.
  const dir = join(import.meta.dirname, '../components/src');
  const selectors = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    for (const [, name] of readFileSync(join(dir, file), 'utf8').matchAll(
      /selector: '([a-z]+(?:-[a-z]+)+)'/g,
    )) {
      selectors.add(name);
    }
  }
  assert.ok(selectors.size > 10, 'the selectors were found');
  for (const name of selectors) {
    const messages = await lint(`<${name} (click)="go()"></${name}>`, 'a.html');
    assert.equal(messages.length, 1, `<${name}>`);
  }
});
