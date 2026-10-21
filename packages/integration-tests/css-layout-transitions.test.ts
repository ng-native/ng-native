/**
 * CSS transitions of a box's size and place, played by native. A width cannot be eased by
 * native's animation driver: it moves other boxes, and that is layout. React Native's layout
 * animation is what does: the commit says where everything ends up, and native moves each view
 * whose frame changed there over the time it is given. So a bar that grows is the one commit,
 * where easing it from JavaScript is a commit a frame.
 *
 * It moves every frame the commit changes, and by one of four curves. So it is used where the
 * only boxes a commit resizes are the ones in transition, and JavaScript eases them otherwise.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Engine,
  getFabricUIManager,
  registerPlatformComponents,
  type EngineNode,
  type StyleSheet,
} from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const CSS = `
  .a { width: 10px; transition: width 200ms ease-in-out }
  .a.on { width: 30px }
  .a.far { width: 50px }
  .a.straight { transition-timing-function: linear }
  .a.brief { transition-duration: 20ms }
  .b.tall { height: 40px }
  .b.red { background-color: red }
`;

function scene({ native = true } = {}) {
  const fabric = createFakeFabric();
  const asked: { duration: number; update: { type: string } }[] = [];
  if (native) {
    Object.assign(fabric, {
      configureNextLayoutAnimation: (config: (typeof asked)[number]) => void asked.push(config),
    });
  }
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS) as StyleSheet,
    now: () => now,
  });
  const make = (classes: string): EngineNode => {
    const view = engine.createElement('view');
    engine.setClasses(view, classes);
    engine.appendChild(engine.root, view);
    return view;
  };
  const a = make('a');
  const b = make('b');
  const events: string[] = [];
  for (const name of ['topTransitionstart', 'topTransitionend']) {
    engine.setEventListener(a, name, () => void events.push(name.slice(13)));
  }
  engine.commit();
  engine.advanceAnimations();
  const width = () => Math.round(Number(fabric.committed[0]!.props['width']) * 100) / 100;
  const later = (ms: number) => {
    now += ms;
    const live = engine.advanceAnimations();
    engine.commit();
    return live;
  };
  return { engine, a, b, asked, events, width, later };
}

describe('a transition of a width', () => {
  it('is the one commit, to where it ends, with native asked to move the view there', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a on');
    s.engine.commit();
    assert.deepEqual(s.asked, [{ duration: 200, update: { type: 'easeInEaseOut' } }]);
    assert.equal(s.width(), 30);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.events, ['start']);
  });

  it('is asked for by the curve nearest its own', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a straight on');
    s.engine.commit();
    assert.equal(s.asked.at(-1)!.update.type, 'linear');
  });

  it('says it has ended when its time is up', async () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a brief on');
    s.engine.commit();
    assert.deepEqual(s.events, ['start']);
    assert.equal(s.asked.at(-1)?.duration, 20);
    await new Promise((done) => setTimeout(done, 60));
    assert.deepEqual(s.events, ['start', 'end']);
  });

  it('is not disturbed by paint, or a prop that is no style, changing in the commit', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a on');
    s.engine.setClasses(s.b, 'b red');
    s.engine.setProp(s.b, 'accessibilityLabel', 'beside');
    s.engine.commit();
    assert.equal(s.asked.length, 1);
    assert.equal(s.width(), 30);
  });

  it('is eased from JavaScript where another box is resized in the commit', () => {
    // Native would move that one over the same time, and nothing asked for it to be moved.
    const s = scene();
    s.engine.setClasses(s.a, 'a on');
    s.engine.setClasses(s.b, 'b tall');
    s.engine.commit();
    assert.equal(s.asked.length, 0);
    assert.equal(s.width(), 10);
    assert.equal(s.engine.animating, true);
    s.later(100);
    assert.equal(s.width(), 20);
    s.later(100);
    assert.equal(s.width(), 30);
    assert.deepEqual(s.events, ['start', 'end']);
  });

  it('is laid out by native again in the commit after one that was not', () => {
    // The frames JavaScript eases it by are a box resized, and are no other box's.
    const s = scene();
    s.engine.setClasses(s.a, 'a straight on');
    s.engine.setClasses(s.b, 'b tall');
    s.engine.commit();
    assert.equal(s.asked.length, 0);
    // Sent somewhere else at once, in a commit that resizes nothing else.
    s.engine.setClasses(s.a, 'a straight far');
    s.engine.commit();
    assert.equal(s.asked.length, 1);
    assert.equal(s.width(), 50);
  });

  it('is sent another way from where it has got to, with native asked again', () => {
    const s = scene();
    s.engine.setClasses(s.a, 'a straight on');
    s.engine.commit();
    s.later(50);
    s.engine.setClasses(s.a, 'a straight');
    s.engine.commit();
    assert.equal(s.asked.length, 2);
    assert.equal(s.width(), 10);
    assert.equal(s.engine.animating, false);
  });

  it('is committed where it ends, with nothing asked of native, once it is sent on again and again', () => {
    // A progress bar steps every 50ms and eases each step over 200: native would be moving the
    // view, and laying the screen out, every frame for as long as the bar moves.
    const s = scene();
    const widths: number[] = [];
    for (const [step, classes] of ['a on', 'a far', 'a on', 'a far', 'a on'].entries()) {
      if (step) s.later(50);
      s.engine.setClasses(s.a, classes);
      s.engine.commit();
      widths.push(s.width());
    }
    assert.deepEqual(widths, [30, 50, 30, 50, 30]);
    // The first and the one sent back are played by native; the rest are where they end.
    assert.equal(s.asked.length, 2);
    assert.equal(s.engine.animating, false);
    // And each of those says it has ended, as it has.
    assert.equal(s.events.filter((each) => each === 'end').length, 3);
  });

  it('is played by native again once it has been left alone for as long as it lasts', () => {
    const s = scene();
    for (const [step, classes] of ['a on', 'a far', 'a on'].entries()) {
      if (step) s.later(50);
      s.engine.setClasses(s.a, classes);
      s.engine.commit();
    }
    s.later(250);
    s.engine.setClasses(s.a, 'a far');
    s.engine.commit();
    assert.equal(s.asked.length, 3);
    assert.equal(s.width(), 50);
  });
});

describe('a transition of a width on a host with no layout animation', () => {
  // Android unless the app turns layout animations on: JavaScript eases it, a commit a frame.
  it('is eased from JavaScript, a commit a frame, when it starts on its own', () => {
    const s = scene({ native: false });
    s.engine.setClasses(s.a, 'a straight on');
    s.engine.commit();
    assert.equal(s.width(), 10);
    assert.equal(s.engine.animating, true);
    s.later(100);
    assert.equal(s.width(), 20);
    s.later(100);
    assert.equal(s.width(), 30);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.events, ['start', 'end']);
  });

  it('is committed where it ends once it is sent on again and again, as native has it', () => {
    // A progress bar that steps every 50ms and eases each step over 200 would keep JavaScript
    // committing every frame for as long as the bar moves.
    const s = scene({ native: false });
    const widths: number[] = [];
    for (const [step, classes] of ['a on', 'a far', 'a on', 'a far', 'a on'].entries()) {
      if (step) s.later(50);
      s.engine.setClasses(s.a, classes);
      s.engine.commit();
      widths.push(s.width());
    }
    // The first two are eased from where the bar is drawn; the rest are where they end.
    assert.equal(widths[0], 10);
    assert.ok(widths[1]! > 10 && widths[1]! < 30, `eased from where it is drawn: ${widths[1]}`);
    assert.deepEqual(widths.slice(2), [30, 50, 30]);
    assert.equal(s.engine.animating, false);
    assert.equal(s.events.filter((each) => each === 'end').length, 3);
  });

  it('is eased from JavaScript again once it has been left alone for as long as it lasts', () => {
    const s = scene({ native: false });
    for (const [step, classes] of ['a on', 'a far', 'a on'].entries()) {
      if (step) s.later(50);
      s.engine.setClasses(s.a, classes);
      s.engine.commit();
    }
    s.later(250);
    s.engine.setClasses(s.a, 'a straight far');
    s.engine.commit();
    assert.equal(s.engine.animating, true);
    s.later(100);
    assert.equal(s.width(), 40);
  });
});

describe('a transition of a width on a device whose layout animations are off', () => {
  // React Native turns Fabric's layout animations off on Android unless the app turns them on
  // (`enableLayoutAnimationsOnAndroid`). There, `configureNextLayoutAnimation` is still there to
  // call and does nothing, so a size committed where it ends would be drawn there at once.
  type Flags = Record<string, () => boolean>;

  function onDevice(platform: string, flags: Flags | null, through: 'bridgeless' | 'bridge') {
    const fabric = createFakeFabric();
    const asked: unknown[] = [];
    Object.assign(fabric, {
      configureNextLayoutAnimation: (config: unknown) => asked.push(config),
    });
    const host = globalThis as Record<string, unknown>;
    host['nativeFabricUIManager'] = fabric;
    if (through === 'bridgeless') {
      host['nativeModuleProxy'] = flags ? { NativeReactNativeFeatureFlagsCxx: flags } : {};
    } else {
      host['__turboModuleProxy'] = (name: string) =>
        name === 'NativeReactNativeFeatureFlagsCxx' ? flags : null;
    }
    registerPlatformComponents(platform);
    let now = 0;
    const engine = new Engine(getFabricUIManager(), 1, {
      globalStyles: compileCss(CSS) as StyleSheet,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'a straight');
    engine.appendChild(engine.root, view);
    engine.commit();
    engine.advanceAnimations();
    engine.setClasses(view, 'a straight on');
    engine.commit();
    now += 100;
    engine.advanceAnimations();
    engine.commit();
    return { asked, width: fabric.committed[0]!.props['width'] };
  }

  function restore(): void {
    const host = globalThis as Record<string, unknown>;
    for (const name of ['nativeFabricUIManager', 'nativeModuleProxy', '__turboModuleProxy']) {
      delete host[name];
    }
    registerPlatformComponents('ios');
  }

  const off = (name: string): Flags => ({ [name]: () => false });

  for (const through of ['bridgeless', 'bridge'] as const) {
    it(`is eased from JavaScript on Android (${through})`, () => {
      try {
        const s = onDevice('android', off('enableLayoutAnimationsOnAndroid'), through);
        assert.deepEqual(s.asked, []);
        assert.equal(s.width, 20, 'half way, where a commit at its end would be 30');
      } finally {
        restore();
      }
    });
  }

  it('is eased from JavaScript on iOS where they are turned off there', () => {
    try {
      const s = onDevice('ios', off('enableLayoutAnimationsOnIOS'), 'bridgeless');
      assert.deepEqual(s.asked, []);
      assert.equal(s.width, 20);
    } finally {
      restore();
    }
  });

  it('is laid out by native where the platform it runs on has them on', () => {
    // The flag of the other platform is not this one's.
    try {
      const s = onDevice('ios', off('enableLayoutAnimationsOnAndroid'), 'bridgeless');
      assert.equal(s.asked.length, 1);
      assert.equal(s.width, 30);
    } finally {
      restore();
    }
  });

  it('is laid out by native where the app turned them on for Android', () => {
    try {
      const s = onDevice('android', { enableLayoutAnimationsOnAndroid: () => true }, 'bridgeless');
      assert.equal(s.asked.length, 1);
      assert.equal(s.width, 30);
    } finally {
      restore();
    }
  });

  it('is laid out by native where there is no flag to read', () => {
    try {
      const s = onDevice('android', null, 'bridgeless');
      assert.equal(s.asked.length, 1);
    } finally {
      restore();
    }
  });
});

describe('a @keyframes animation of a height', () => {
  // A panel that slides open: two frames of a height, which is layout, and a commit a frame
  // from JavaScript. As a transition of one is, it is the one commit to where it ends, with
  // native asked to move the views there, where nothing else in the commit moves.
  const PANEL = `
    @keyframes open { from { height: 0 } to { height: 40px } }
    @keyframes shut { from { height: 40px } to { height: 0 } }
    @keyframes grow { from { height: 10px } to { height: 40px } }
    .p { height: 0 }
    .p.open { height: 40px; animation: open 200ms ease-in-out forwards }
    .p.shut { animation: shut 200ms ease-in-out forwards }
    .p.grow { animation: grow 200ms linear forwards }
    .p.brief { height: 40px; animation: open 20ms linear }
    .b.tall { height: 40px }
    .c { width: 10px; transition: width 150ms linear }
    .c.wide { width: 30px }
  `;

  function panel() {
    const fabric = createFakeFabric();
    const asked: { duration: number; update: { type: string } }[] = [];
    Object.assign(fabric, {
      configureNextLayoutAnimation: (config: (typeof asked)[number]) => void asked.push(config),
    });
    let now = 0;
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(PANEL) as StyleSheet,
      now: () => now,
    });
    const make = (classes: string): EngineNode => {
      const view = engine.createElement('view');
      engine.setClasses(view, classes);
      engine.appendChild(engine.root, view);
      return view;
    };
    const p = make('p');
    const b = make('b');
    const events: string[] = [];
    for (const name of ['topAnimationstart', 'topAnimationend']) {
      engine.setEventListener(p, name, () => void events.push(name.slice(12)));
    }
    engine.commit();
    engine.advanceAnimations();
    const height = () => Math.round(Number(fabric.committed[0]!.props['height']) * 100) / 100;
    const classes = (names: string) => {
      engine.setClasses(p, names);
      engine.commit();
    };
    const later = (ms: number) => {
      now += ms;
      const live = engine.advanceAnimations();
      engine.commit();
      return live;
    };
    return { engine, p, b, asked, events, height, classes, later };
  }

  it('is the one commit, to its last frame, with native asked to move the view there', () => {
    const s = panel();
    s.classes('p open');
    assert.deepEqual(s.asked, [{ duration: 200, update: { type: 'easeInEaseOut' } }]);
    assert.equal(s.height(), 40);
    assert.equal(s.engine.animating, false);
    assert.deepEqual(s.events, ['start']);
  });

  it('says it has ended when its time is up, and gives back what it held where it does not fill', async () => {
    const s = panel();
    s.classes('p brief');
    assert.equal(s.asked.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(s.events, ['start', 'end']);
    assert.equal(s.height(), 40);
  });

  it('is played the other way by native too, from where the first left it', () => {
    const s = panel();
    s.classes('p open');
    s.classes('p shut');
    assert.equal(s.asked.length, 2);
    assert.equal(s.height(), 0);
  });

  it('is the one native lays out where a shorter transition starts in the commit with it', () => {
    // Native takes one length of time for a commit. A bar that ticks along beside the panel
    // is eased from JavaScript for that tick, and the panel is not given up for it.
    const s = panel();
    const c = s.engine.createElement('view');
    s.engine.setClasses(c, 'c');
    s.engine.appendChild(s.engine.root, c);
    s.engine.commit();
    s.engine.advanceAnimations();
    s.engine.setClasses(c, 'c wide');
    s.classes('p open');
    assert.deepEqual(s.asked, [{ duration: 200, update: { type: 'easeInEaseOut' } }]);
    assert.equal(s.height(), 40);
    assert.equal(s.engine.animating, true, 'the bar, from JavaScript');
    assert.equal(s.engine.root.childList[2]!.committed!.props['width'], 10);
  });

  it('is played from JavaScript where another box is resized in the commit', () => {
    const s = panel();
    s.engine.setClasses(s.b, 'b tall');
    s.classes('p open');
    assert.deepEqual(s.asked, []);
    assert.equal(s.height(), 0);
    assert.equal(s.engine.animating, true);
    s.later(100);
    assert.equal(s.height(), 20);
  });

  it('is played from JavaScript where its first frame is not where the view is', () => {
    // Native moves a view from where it is drawn, which is then not where the animation starts.
    const s = panel();
    s.classes('p grow');
    assert.deepEqual(s.asked, []);
    assert.equal(s.height(), 10);
    assert.equal(s.engine.animating, true);
  });
});
