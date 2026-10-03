/**
 * Expo, reached without Expo's React.
 *
 * Two halves. A view's Fabric name is the whole contract for `registerExpoView`, and a name that
 * does not match commits as an unimplemented view with no error at all, so the derivation is
 * pinned here where a device is not needed to see it. The services are the other half: the
 * behaviour lives in classes that take their native surface, which is what lets a fake stand in
 * for Expo in Node, where React Native's Flow source cannot be parsed at all.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErrorHandler, InjectionToken, type Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { compileFixture } from './compile.ts';
import {
  expoViewName,
  registerExpoView,
  registerExpoViews,
  registerNativeViews,
  registerExpoUiViews,
} from '@ng-native/expo';
import { EXPO_UI_VIEWS } from '../expo/src/expo-ui.ts';
import { Clipboard } from '@ng-native/expo/clipboard';
import { FileSystem, type NativeFile } from '@ng-native/expo/file-system';
import { Haptics } from '@ng-native/expo/haptics';
import { serviceWith } from './injected.ts';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';

/** Expo Go installs this; a standalone build does not. */
function asExpoGo(identifier: string | undefined): void {
  const global = globalThis as { expo?: { __expo_app_identifier__?: string } };
  if (identifier === undefined) delete global.expo;
  else global.expo = { __expo_app_identifier__: identifier };
}

describe('expo view names', () => {
  afterEach(() => asExpoGo(undefined));

  it('names a module default view', () => {
    assert.equal(expoViewName('ExpoImage'), 'ViewManagerAdapter_ExpoImage');
  });

  it('names a second view on the same module', () => {
    assert.equal(
      expoViewName('ExpoClipboard', 'PasteButton'),
      'ViewManagerAdapter_ExpoClipboard_PasteButton',
    );
  });

  it('carries the app identifier, because Expo Go namespaces every view by project', () => {
    asExpoGo('abc123');
    assert.equal(expoViewName('ExpoImage'), 'ViewManagerAdapter_ExpoImage_abc123');
    assert.equal(
      expoViewName('ExpoImage', 'Ref'),
      'ViewManagerAdapter_ExpoImage_Ref_abc123',
      'the identifier goes last, after the view name',
    );
  });
});

describe('an expo view in the tree', () => {
  let fabric: FakeFabric;
  let engine: Engine;

  beforeEach(() => {
    fabric = createFakeFabric();
    engine = new Engine(fabric, 1, { processColor: (value) => value });
  });

  afterEach(() => asExpoGo(undefined));

  it('commits under the adapter name, with the module props passed straight through', () => {
    registerExpoView('expo-image', 'ExpoImage', { defaultProps: { contentFit: 'cover' } });

    const image = engine.createElement('expo-image');
    engine.setProp(image, 'source', [{ uri: 'https://example.com/a.png' }]);
    engine.appendChild(engine.root, image);
    engine.commit();

    const [node] = fabric.committed;
    assert.equal(node?.viewName, 'ViewManagerAdapter_ExpoImage');
    assert.equal(node?.props['contentFit'], 'cover', 'the default the React wrapper would apply');
    assert.deepEqual(node?.props['source'], [{ uri: 'https://example.com/a.png' }]);
  });

  it('is not mistaken for a primitive whose component was forgotten', () => {
    const reports: string[] = [];
    const original = console.error;
    console.error = (message: string) => reports.push(message);
    try {
      const dev = new Engine(createFakeFabric(), 1, { dev: true, processColor: (v) => v });
      registerExpoView('expo-blur', 'ExpoBlurView');
      dev.appendChild(dev.root, dev.createElement('expo-blur'));
      dev.commit();
    } finally {
      console.error = original;
    }
    assert.deepEqual(reports, [], 'nothing in components claims an Expo view, and nothing should');
  });

  it('registers the name it had at startup, identifier and all', () => {
    asExpoGo('canary');
    registerExpoView('expo-blur', 'ExpoBlurView');

    engine.appendChild(engine.root, engine.createElement('expo-blur'));
    engine.commit();

    assert.equal(fabric.committed[0]?.viewName, 'ViewManagerAdapter_ExpoBlurView_canary');
  });
});

/**
 * Every service is a `@Service()` class reading its platform through an injected source token, so
 * this pins the shape rather than any one of them: nothing is constructed until something injects
 * it, it is constructed once, and an app can put a fake in front of the platform without knowing
 * anything about how the service reaches it.
 */
describe('the shape every service uses', () => {
  it('constructs on first injection, once, for the life of the app', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/counter.ts', import.meta.url)),
    );

    let subscribed = 0;
    const app = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric(), {
      providers: [
        {
          provide: Clipboard.SOURCE,
          useValue: {
            getStringAsync: async () => 'from the fake',
            setStringAsync: async () => true,
            addClipboardListener: () => {
              subscribed += 1;
              return { remove: () => {} };
            },
          },
        },
      ],
    });

    assert.equal(subscribed, 0, 'a service nobody injects is never constructed');

    const first = app.componentRef.injector.get(Clipboard);
    assert.equal(subscribed, 1, 'injecting it constructed it');
    assert.equal(await first.read(), 'from the fake', 'and it reached the provided platform');

    const second = app.componentRef.injector.get(Clipboard);
    assert.equal(second, first, 'one instance, as a root service');
    assert.equal(subscribed, 1);
  });
});

describe('haptics', () => {
  const calls: string[] = [];
  const native = {
    impactAsync: (style: string) => (calls.push(`impact:${style}`), Promise.resolve()),
    notificationAsync: (type: string) => (calls.push(`notify:${type}`), Promise.resolve()),
    selectionAsync: () => (calls.push('select'), Promise.resolve()),
  };

  beforeEach(() => (calls.length = 0));

  it('plays each kind of feedback, defaulting an impact to medium', () => {
    const haptics = serviceWith(Haptics.SOURCE, native, () => new Haptics());
    haptics.impact();
    haptics.impact('heavy');
    haptics.notify('success');
    haptics.select();
    assert.deepEqual(calls, ['impact:medium', 'impact:heavy', 'notify:success', 'select']);
    assert.equal(haptics.available, true);
  });

  it('does nothing at all when the module is not installed', () => {
    const haptics = serviceWith(Haptics.SOURCE, null, () => new Haptics());
    assert.equal(haptics.available, false);
    haptics.impact();
    assert.deepEqual(calls, [], 'and no throw, because nobody awaits a vibration');
  });

  it('swallows a rejection, so a missing Taptic Engine is not an unhandled promise', () => {
    const haptics = serviceWith(
      Haptics.SOURCE,
      { ...native, impactAsync: () => Promise.reject(new Error('no haptics here')) },
      () => new Haptics(),
    );
    haptics.impact();
  });
});

describe('the clipboard', () => {
  function fake(text = '') {
    let notify = () => {};
    const written: string[] = [];
    return {
      written,
      change: () => notify(),
      native: {
        getStringAsync: () => Promise.resolve(text),
        setStringAsync: (value: string) => (written.push(value), Promise.resolve(true)),
        addClipboardListener: (listener: () => void) => {
          notify = listener;
          return { remove: () => (notify = () => {}) };
        },
      },
    };
  }

  it('counts pasteboard changes as a signal, and reads nothing on its own', async () => {
    const stub = fake('hello');
    const clipboard = serviceWith(Clipboard.SOURCE, stub.native, () => new Clipboard());
    assert.equal(clipboard.changes(), 0);

    stub.change();
    stub.change();
    assert.equal(clipboard.changes(), 2, 'the notification is free; the read is not');

    assert.equal(await clipboard.read(), 'hello');
  });

  it('writes through to native', async () => {
    const stub = fake();
    const clipboard = serviceWith(Clipboard.SOURCE, stub.native, () => new Clipboard());
    await clipboard.write('copied');
    assert.deepEqual(stub.written, ['copied']);
  });

  it('reads empty rather than throwing with no module installed', async () => {
    const clipboard = serviceWith(Clipboard.SOURCE, null, () => new Clipboard());
    assert.equal(await clipboard.read(), '');
  });
});

describe('the file system', () => {
  function fakeFile(exists: boolean) {
    const written: (string | Uint8Array)[] = [];
    let created = 0;
    const file = {
      uri: 'file:///canary.txt',
      exists,
      size: 0,
      create: () => created++,
      write: (content: string | Uint8Array) => written.push(content),
      text: () => Promise.resolve(written.join('')),
      textSync: () => written.join(''),
      bytes: () => Promise.resolve(written.at(-1) as Uint8Array),
      delete: () => {},
    } satisfies NativeFile;
    return { file, written, creations: () => created };
  }

  const files = (file: NativeFile) => ({
    cacheDirectory: { name: 'cache' },
    documentDirectory: { name: 'documents' },
    file: (directory: object, name: string) => {
      asked.push(`${(directory as { name: string }).name}/${name}`);
      return file;
    },
  });
  let asked: string[] = [];

  beforeEach(() => (asked = []));

  it('names a file in the directory that matches what it is for', () => {
    const { file } = fakeFile(true);
    const system = serviceWith(FileSystem.SOURCE, files(file), () => new FileSystem());
    system.cache('canary.txt');
    system.document('canary.txt');
    assert.deepEqual(asked, ['cache/canary.txt', 'documents/canary.txt']);
  });

  it('opens the file at a uri, such as one a picker answered with', async () => {
    const picked = fakeFile(true);
    picked.file.write('contents');
    const uris: string[] = [];
    const source = {
      ...files(picked.file),
      fileAt: (uri: string) => (uris.push(uri), picked.file),
    };
    const system = serviceWith(FileSystem.SOURCE, source, () => new FileSystem());
    assert.equal(await system.file('file:///picked/report.txt').text(), 'contents');
    assert.deepEqual(uris, ['file:///picked/report.txt']);
  });

  it('says so when a stand-in cannot open a uri', () => {
    const { file } = fakeFile(true);
    const system = serviceWith(FileSystem.SOURCE, files(file), () => new FileSystem());
    assert.throws(() => system.file('file:///x'), /no fileAt\(uri\)/);
  });

  it('creates a file that is not there before writing it', () => {
    const missing = fakeFile(false);
    const system = serviceWith(FileSystem.SOURCE, files(missing.file), () => new FileSystem());
    system.write(missing.file, 'hello');
    assert.equal(missing.creations(), 1);
    assert.deepEqual(missing.written, ['hello']);
  });

  it('writes bytes as bytes, for a file that is not text', async () => {
    const missing = fakeFile(false);
    const system = serviceWith(FileSystem.SOURCE, files(missing.file), () => new FileSystem());
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
    system.write(missing.file, pdf);
    assert.equal(missing.creations(), 1);
    assert.equal(missing.written[0], pdf, 'handed to Expo as it is, not turned into text');
    assert.deepEqual(await missing.file.bytes(), pdf);
  });

  it('writes an existing file without creating it again', () => {
    const present = fakeFile(true);
    const system = serviceWith(FileSystem.SOURCE, files(present.file), () => new FileSystem());
    system.write(present.file, 'hello');
    assert.equal(present.creations(), 0, 'create() throws on a file that is already there');
  });

  it('says there is no module to load rather than failing on a directory it does not have', () => {
    const system = serviceWith(FileSystem.SOURCE, null, () => new FileSystem());
    const notInstalled = { message: /expo-file-system has no native module to load in Node/ };
    assert.throws(() => system.cache('canary.txt'), notInstalled);
    assert.throws(() => system.document('canary.txt'), notInstalled);
  });
});

describe('the views worth knowing the names of', () => {
  it('registers a known one by its element name', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoViews('expo-blur');

    engine.appendChild(engine.root, engine.createElement('expo-blur'));
    engine.commit();

    const view = fabric.committed[0]!;
    assert.match(view.viewName, /ExpoBlurView/, 'committed as the module its name says');
    assert.equal(view.props['intensity'], 50, 'with the defaults the React component applies');
  });

  it('names SF Symbols by the module expo-symbols registers', () => {
    // expo-symbols asks for requireNativeViewManager('SymbolModule'). Any other name commits as
    // UnimplementedNativeView: a red box, on a device, and nothing in a test.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoViews('expo-symbol');

    engine.appendChild(engine.root, engine.createElement('expo-symbol'));
    engine.commit();

    assert.equal(fabric.committed[0]!.viewName, 'ViewManagerAdapter_SymbolModule');
  });

  it('says so rather than registering an element that commits as nothing', () => {
    // A name that is not known would otherwise be an element whose native side never arrives,
    // which looks exactly like a module the app forgot to install.
    assert.throws(() => registerExpoViews('expo-nothing' as 'expo-blur'), /no Expo view is known/);
  });
});

describe('the native views that are not Expo modules', () => {
  it('registers one under its own Fabric name, not a ViewManagerAdapter one', () => {
    // These libraries generate their own component names; only Expo's modules get the adapter
    // prefix, and using it here would be an element that commits as nothing.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerNativeViews('slider');

    engine.appendChild(engine.root, engine.createElement('slider'));
    engine.commit();

    assert.equal(fabric.committed[0]?.viewName, 'RNCSlider');
    assert.equal(fabric.committed[0]?.props['maximumValue'], 1);
  });

  it('asks an old-architecture control for its change events, as a React handler would', () => {
    // The segmented control is a Paper view manager run through Fabric's interop layer, which
    // only installs the onChange block when the prop is set. Without it, taps change the
    // control on screen and no event is ever sent.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerNativeViews('segmented-control');

    engine.appendChild(engine.root, engine.createElement('segmented-control'));
    engine.commit();

    assert.equal(fabric.committed[0]?.viewName, 'RNCSegmentedControl');
    assert.equal(fabric.committed[0]?.props['onChange'], true);
  });

  it('says so rather than registering a name nothing will answer to', () => {
    assert.throws(() => registerNativeViews('nope' as 'slider'), /no native view is known/);
  });
});

describe('the SwiftUI and Compose views', () => {
  it('accepts Platform.OS directly, and registers nothing on a platform neither ships for', () => {
    // The docs pass `Platform.OS` straight through - `'ios' | 'android' | 'macos' | 'windows' |
    // 'web'` from react-native, not the narrower `'ios' | 'android'` this took before. Web is the
    // one every canary app also runs on, so it is the one that would have caught a fallthrough to
    // the Android table. Run before any other test in this file touches the registry, since
    // registration only ever adds names and never removes them.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoUiViews('web');

    engine.appendChild(engine.root, engine.createElement('ui-toggle'));
    engine.commit();
    assert.doesNotMatch(fabric.committed[0]!.viewName, /ExpoUI/);
  });

  it('registers the slot on both platforms, which twenty SwiftUI views need', () => {
    // `Slot` is how a composite SwiftUI view takes its children - a picker's options, a
    // section's rows. It had been recorded as Android-only because SwiftUI's lives in a
    // top-level file rather than a directory, and without it those children mount into a plain
    // UIView: a red screen on iOS, and a control that draws nothing.
    //
    // Mounted rather than read off the table: the table being right is not the claim, the element
    // reaching a native view is - and this passed while the registration was broken.
    for (const platform of ['ios', 'android'] as const) {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { processColor: (value) => value });
      registerExpoUiViews(platform);

      engine.appendChild(engine.root, engine.createElement('ui-slot'));
      engine.commit();
      assert.match(fabric.committed[0]!.viewName, /SlotView/, platform);
    }
  });

  it('registers the platform-neutral name against the platform that has it', () => {
    // `@expo/ui` reaches these through `requireNativeView('ExpoUI', ...)`, which is the same
    // derivation `registerExpoView` mirrors - so the whole surface is a table of names.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoUiViews('ios');

    engine.appendChild(engine.root, engine.createElement('ui-slider'));
    engine.commit();
    assert.match(fabric.committed[0]!.viewName, /ExpoUI_SliderView/);
  });

  it('registers the SwiftUI list, whose rows take native swipe actions', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoUiViews('ios');
    engine.appendChild(engine.root, engine.createElement('ui-list'));
    engine.commit();
    assert.match(fabric.committed[0]!.viewName, /ExpoUI_ListView/);
  });

  it('asks Expo for each view it registers, as Android only sends a view its events once asked', () => {
    const asked: [string, string | undefined][] = [];
    const global = globalThis as { require?: (name: string) => unknown };
    global.require = (name: string) => {
      if (name !== 'expo') throw new Error(`no ${name}`);
      return {
        requireNativeView: (module: string, view?: string) => asked.push([module, view]),
      };
    };
    try {
      registerExpoView('ui-switch-probe', 'ExpoUI', { viewName: 'SwitchView' });
      registerExpoViews('expo-image');
    } finally {
      delete global.require;
    }
    assert.deepEqual(asked, [
      ['ExpoUI', 'SwitchView'],
      ['ExpoImage', undefined],
    ]);
  });

  it('hosts the controls in the view each platform draws them in', () => {
    for (const platform of ['ios', 'android'] as const) {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { processColor: (value) => value });
      registerExpoUiViews(platform);
      engine.appendChild(engine.root, engine.createElement('ui-host'));
      engine.commit();
      assert.match(fabric.committed[0]!.viewName, /ExpoUI_HostView$/, platform);
    }
  });

  it('registers the other platform view for the same element', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoUiViews('android');

    engine.appendChild(engine.root, engine.createElement('ui-vstack'));
    engine.commit();
    // Compose calls it a Column; an app should not have to.
    assert.match(fabric.committed[0]!.viewName, /ExpoUI_ColumnView/);
  });

  it('leaves an element alone on a platform that has no such control', () => {
    /*
     * A Gauge is SwiftUI's. Registering it on Android would be an element that commits as nothing,
     * which looks exactly like a module that failed to install.
     *
     * Half of this is mounted and half is read off the table, and the split is not laziness.
     * `registerViewName` writes into one process-wide map that no test can clear, so once any
     * earlier test has registered the iOS set, `ui-gauge` resolves for the rest of the run - an
     * absence cannot be observed behaviourally from in here. What can be observed is that iOS
     * really does reach a native view, and that the table Android registration reads has no entry
     * to give it.
     */
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { processColor: (value) => value });
    registerExpoUiViews('ios');
    engine.appendChild(engine.root, engine.createElement('ui-gauge'));
    engine.commit();
    assert.match(fabric.committed[0]!.viewName, /ExpoUI_GaugeView/, 'iOS has one');

    assert.equal(EXPO_UI_VIEWS['gauge']?.[1], null, 'and Android is given nothing to register');
  });
});

describe('the typed SwiftUI and segmented-control components', () => {
  let fabric: FakeFabric;
  let app: ReturnType<typeof mount>;
  let fixture: { presses(): number; date(): string; index(): number; due(): Date };
  const all = (n: readonly FakeFabricNode[]): FakeFabricNode[] =>
    n.flatMap((x) => [x, ...all(x.children)]);
  const named = (pattern: RegExp) => all(fabric.committed).find((n) => pattern.test(n.viewName))!;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  let Fixture: Type<unknown>;
  const errors: unknown[] = [];

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/expo-ui.ts', import.meta.url)),
    );
    Fixture = mod['ExpoUiFixture'] as Type<unknown>;
  });

  beforeEach(async () => {
    registerExpoUiViews('ios');
    registerNativeViews('segmented-control', 'date-time-picker');
    fabric = createFakeFabric();
    app = mount(1, Fixture, fabric, {
      providers: [
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
      ],
    });
    fixture = app.componentRef.instance as typeof fixture;
    await settle();
  });

  it('passes each input to the native view as the prop of the same name', () => {
    assert.equal(named(/HostView/).props['ignoreSafeArea'], 'container');
    // Except `matchContents`, which native reads as a flag per axis; see `UiHost`.
    assert.equal(named(/HostView/).props['matchContentsVertical'], true);
    assert.equal(named(/HostView/).props['matchContentsHorizontal'], true);
    assert.equal(named(/ExpoUI_MenuView/).props['accessibilityLabel'], 'More');
    assert.deepEqual(named(/ExpoUI_MenuView/).props['modifiers'], [
      { $type: 'opacity', value: 0.5 },
    ]);
    assert.equal(named(/ExpoUI_Button$/).props['role'], 'destructive');
    assert.deepEqual(named(/DatePicker/).props['displayedComponents'], ['date']);
    assert.deepEqual(named(/RNCSegmentedControl/).props['values'], ['A', 'B']);
    assert.equal(named(/RNCSegmentedControl/).props['onChange'], true, 'the default still applies');
    assert.equal('title' in named(/DatePicker/).props, false, 'an unset input sends nothing');

    // The rest of the typed SwiftUI surface: a divider and a slot inside the menu, and an image
    // that is not inside one at all.
    assert.equal(named(/ExpoUI_SlotView/).props['name'], 'label');
    assert.equal(named(/ExpoUI_TextView/).props['text'], 'More');
    assert.equal(named(/ExpoUI_DividerView/) !== undefined, true, 'committed, even with no props');
    assert.equal(named(/ExpoUI_ImageView/).props['systemName'], 'star');
    assert.equal(named(/ExpoUI_ImageView/).props['size'], 24);
    assert.equal(named(/ExpoUI_ImageView/).props['color'], '#ff0000');
  });

  it('hands the native events to the outputs', async () => {
    fabric.emit(named(/ExpoUI_Button$/), 'topButtonPress');
    fabric.emit(named(/DatePicker/), 'topDateChange', { date: '2026-03-04T00:00:00Z' });
    fabric.emit(named(/RNCSegmentedControl/), 'topChange', { selectedSegmentIndex: 1, value: 'B' });
    app.applicationRef.tick();
    await settle();
    assert.equal(fixture.presses(), 1, 'once, not once per route');
    assert.equal(fixture.date(), '2026-03-04T00:00:00Z');
    assert.equal(fixture.index(), 1);
    assert.deepEqual(errors, []);
  });

  it('gives the date picker its dates in milliseconds, and hears a pick as a timestamp', async () => {
    const picker = () => named(/RNDateTimePicker/);
    assert.equal(picker().props['date'], 1800000000000, 'from a Date');
    assert.equal(picker().props['minimumDate'], 1700000000000, 'from milliseconds');
    assert.equal(picker().props['displayIOS'], 'compact');
    assert.equal(picker().props['mode'], 'date');
    assert.equal('maximumDate' in picker().props, false, 'and nothing for what is not set');

    fabric.emit(picker(), 'topChange', { timestamp: 1800086400000, utcOffset: 0 });
    app.applicationRef.tick();
    await settle();
    assert.equal(fixture.due().getTime(), 1800086400000);
    assert.equal(picker().props['date'], 1800086400000);
    assert.deepEqual(errors, []);
  });
});

describe('the typed SwiftUI list', () => {
  const all = (n: readonly FakeFabricNode[]): FakeFabricNode[] =>
    n.flatMap((x) => [x, ...all(x.children)]);

  it('passes a row s swipe actions and layout through as props', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/expo-ui.ts', import.meta.url)),
    );
    registerExpoUiViews('ios');
    const fabric = createFakeFabric();
    const app = mount(1, mod['ExpoUiListFixture'] as Type<unknown>, fabric);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const named = (pattern: RegExp) => all(fabric.committed).find((n) => pattern.test(n.viewName))!;

    assert.deepEqual(named(/ExpoUI_ListView/).props['modifiers'], [
      { $type: 'listStyle', style: 'plain' },
    ]);
    assert.ok(named(/ExpoUI_SwipeActionsView/));
    assert.deepEqual(named(/ExpoUI_SlotView/).props['extraProps'], {
      edge: 'trailing',
      allowsFullSwipe: true,
    });
    assert.equal(named(/ExpoUI_VStackView/).props['alignment'], 'leading');
    assert.equal(named(/ExpoUI_VStackView/).props['spacing'], 2);

    const row = all(fabric.committed).find(
      (n) => /ExpoUI_Button$/.test(n.viewName) && n.props['label'] === undefined,
    )!;
    fabric.emit(row, 'topButtonPress');
    app.applicationRef.tick();
    assert.equal((app.componentRef.instance as { opened(): number }).opened(), 1);

    const slider = named(/ExpoUI_SliderView/);
    assert.equal(slider.props['value'], 0.25);
    assert.equal(slider.props['max'], 1);
    fabric.emit(slider, 'topValueChanged', { value: 0.75 });
    app.applicationRef.tick();
    assert.equal((app.componentRef.instance as { level(): number }).level(), 0.75);
  });
});

describe('the typed SwiftUI controls and expo-image', () => {
  const all = (n: readonly FakeFabricNode[]): FakeFabricNode[] =>
    n.flatMap((x) => [x, ...all(x.children)]);

  it('passes each input through as the prop of the same name, and events to the outputs', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/expo-ui.ts', import.meta.url)),
    );
    registerExpoUiViews('ios');
    registerExpoViews('expo-image');
    const fabric = createFakeFabric();
    const app = mount(1, mod['ExpoUiControlsFixture'] as Type<unknown>, fabric);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const named = (pattern: RegExp) => all(fabric.committed).find((n) => pattern.test(n.viewName))!;

    assert.equal(named(/ExpoUI_ToggleView$/).props['isOn'], true);
    assert.equal(named(/ExpoUI_ToggleView$/).props['label'], 'Wi-Fi');
    assert.equal(named(/ExpoUI_StepperView$/).props['max'], 8);
    assert.equal(named(/ExpoUI_TextFieldView$/).props['placeholder'], 'Name');
    assert.equal(named(/ExpoUI_ColorPickerView$/).props['selection'], '#ff0000');
    assert.equal(named(/ExpoUI_SectionView$/).props['title'], 'Network');
    assert.equal(named(/ExpoUI_HStackView$/).props['spacing'], 4);
    assert.equal(named(/ExpoUI_GaugeView$/).props['currentValueLabel'], '40%');
    assert.equal(named(/ExpoUI_ProgressView$/).props['value'], 0.5);
    const chart = named(/ExpoUI_ChartView$/).props;
    assert.equal(chart['type'], 'pie');
    assert.equal(chart['showGrid'], true);
    assert.deepEqual(chart['data'], [
      { x: 'Won', y: 3 },
      { x: 'Lost', y: 1, color: '#ff0000' },
    ]);
    assert.deepEqual(chart['pieStyle'], { innerRadius: 0.5 });
    assert.ok(!('barStyle' in chart), 'an unset style never reaches native');
    assert.ok(named(/ExpoUI_FormView$/) && named(/ExpoUI_SpacerView$/));
    assert.ok(named(/ExpoUI_LabeledContentView$/));

    fabric.emit(named(/ExpoUI_ToggleView$/), 'topIsOnChange', { isOn: false });
    app.applicationRef.tick();
    assert.equal((app.componentRef.instance as { on(): boolean }).on(), false);

    const image = named(/ExpoImage/);
    assert.deepEqual(image.props['source'], [{ uri: 'a.png' }]);
    assert.equal(image.props['transition'], 300);
    assert.equal(image.props['contentFit'], 'cover', 'the default an unbound input leaves alone');
  });

  it('puts a section and a labelled row content in the content slot, which SwiftUI draws', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/expo-ui.ts', import.meta.url)),
    );
    registerExpoUiViews('ios');
    registerExpoViews('expo-image');
    const fabric = createFakeFabric();
    mount(1, mod['ExpoUiControlsFixture'] as Type<unknown>, fabric);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const named = (pattern: RegExp) => all(fabric.committed).find((n) => pattern.test(n.viewName))!;
    const content = (parent: FakeFabricNode) =>
      parent.children.find((n) => /SlotView$/.test(n.viewName) && n.props['name'] === 'content');

    const section = content(named(/ExpoUI_SectionView$/));
    assert.ok(section, "the section's rows sit in a slot named content");
    assert.ok(
      all(section.children).some((n) => /ExpoUI_ToggleView$/.test(n.viewName)),
      'the toggle is one of them',
    );
    const labelled = content(named(/ExpoUI_LabeledContentView$/));
    assert.ok(labelled, "a labelled row's content sits in a slot named content");
    assert.ok(all(labelled.children).some((n) => /ExpoUI_TextView$/.test(n.viewName)));
  });
});
