/**
 * `@keyframes` and `animation:`, the build-time half.
 *
 * A keyframe animation differs from a transition in the way that matters for `animate.enter`: it
 * plays from its own frames rather than from whatever was on screen, so an element can animate in
 * even though nothing about it changed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

import { Engine } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

interface Frame {
  offset: number;
  declarations: Record<string, unknown>;
}
interface Sheet {
  rules: { declarations: Record<string, unknown> }[];
  keyframes?: Record<string, Frame[]>;
}

const sheet = (css: string): Sheet => compileCss(css) as Sheet;

describe('compiling @keyframes', () => {
  const source = `
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(8px); }
      60% { opacity: 0.8; }
      to { opacity: 1; transform: translateY(0); }
    }
    view { animation: fade-in 300ms ease-out 100ms 2 forwards; }
  `;

  it('collects the frames by name, in order, as fractions', () => {
    const frames = sheet(source).keyframes!['fade-in']!;
    assert.deepEqual(
      frames.map((f) => f.offset),
      [0, 0.6, 1],
      '`from` and `to` are 0 and 1 like any other offset',
    );
  });

  it('puts the frames in order, however the block wrote them', () => {
    const { keyframes } = sheet(
      '@keyframes k { to { opacity: 1 } 50% { opacity: 0.2 } from { opacity: 0 } }',
    );
    assert.deepEqual(
      keyframes!['k']!.map((frame) => frame.offset),
      [0, 0.5, 1],
    );
  });

  it('compiles the declarations in a frame exactly as it would in a rule', () => {
    const frames = sheet(source).keyframes!['fade-in']!;
    assert.equal(frames[0]!.declarations['opacity'], 0);
    assert.deepEqual(frames[0]!.declarations['transform'], [{ translateY: 8 }]);
  });

  it('reads the whole animation shorthand', () => {
    const spec = sheet(source).rules[0]!.declarations['$animation'] as Record<string, unknown>;
    assert.equal(spec['name'], 'fade-in');
    assert.equal(spec['duration'], 300);
    assert.equal(spec['delay'], 100);
    assert.equal(spec['iterations'], 2);
    assert.equal(spec['fill'], 'forwards');
    assert.deepEqual(spec['easing'], [0, 0, 0.58, 1]);
  });

  it('reads an infinite count as what it is', () => {
    const spec = sheet('view { animation: spin 1s linear infinite; }').rules[0]!.declarations[
      '$animation'
    ] as Record<string, unknown>;
    // Null rather than Infinity, and the distinction is the whole bug: the sheet reaches the
    // device as JSON, `JSON.stringify(Infinity)` is `null`, and the runtime multiplied by it to
    // get a total duration of zero. An infinite animation painted its last frame once and
    // stopped. Emitting what survives is what keeps the two halves honest.
    assert.equal(spec['iterations'], null);
    assert.equal(
      JSON.parse(JSON.stringify(spec))['iterations'],
      null,
      'and it is unchanged by the trip into the bundle',
    );
  });

  it('defaults a count of one and no fill', () => {
    const spec = sheet('view { animation: a 1s; }').rules[0]!.declarations['$animation'] as Record<
      string,
      unknown
    >;
    assert.equal(spec['iterations'], 1);
    assert.equal(spec['fill'], 'none');
  });

  it('refuses more than one animation on a rule rather than running the first', () => {
    assert.throws(() => sheet('view { animation: a 1s, b 2s; }'), /one animation/);
  });

  it('reads the direction it plays in', () => {
    const direction = (css: string) =>
      (sheet(`view { ${css} }`).rules[0]!.declarations['$animation'] as { direction?: string })
        .direction;
    assert.equal(direction('animation: a 1s reverse;'), 'reverse');
    assert.equal(direction('animation: a 1s infinite alternate;'), 'alternate');
    assert.equal(direction('animation: a 1s alternate-reverse;'), 'alternate-reverse');
    assert.equal(direction('animation: a 1s;'), undefined, 'normal says nothing');
  });
});

/**
 * The longhands, which say what the shorthand says one part at a time, with the same limits: one
 * animation, always running. Within a rule they apply in order, so a longhand after
 * the shorthand changes that one part and a shorthand after a longhand resets it, as in CSS.
 */
describe('the animation longhands', () => {
  const specOf = (css: string) =>
    sheet(`view { ${css} }`).rules[0]?.declarations['$animation'] as
      Record<string, unknown> | null | undefined;

  it('read into the same spec as the shorthand', () => {
    assert.deepEqual(
      specOf(
        'animation-name: fade-in; animation-duration: 300ms; animation-timing-function: ease-out; ' +
          'animation-delay: 0.1s; animation-iteration-count: 2; animation-fill-mode: forwards; ' +
          'animation-direction: normal; animation-play-state: running;',
      ),
      specOf('animation: fade-in 300ms ease-out 100ms 2 forwards;'),
    );
  });

  it('default what they leave out, as the shorthand does', () => {
    assert.deepEqual(specOf('animation-name: spin;'), {
      name: 'spin',
      duration: 0,
      delay: 0,
      easing: [0.25, 0.1, 0.25, 1],
      iterations: 1,
      fill: 'none',
    });
  });

  it('read an infinite count as the shorthand does', () => {
    assert.equal(
      specOf('animation-name: spin; animation-iteration-count: infinite;')!['iterations'],
      null,
    );
  });

  it('override that one part when written after the shorthand', () => {
    const spec = specOf('animation: spin 1s linear infinite; animation-duration: 2s;')!;
    assert.equal(spec['duration'], 2000);
    assert.equal(spec['name'], 'spin');
    assert.deepEqual(spec['easing'], [0, 0, 1, 1]);
    assert.equal(spec['iterations'], null);
    assert.equal(specOf('animation: a 1s 200ms; animation-delay: 0s;')!['delay'], 0);
    assert.equal(specOf('animation: a 1s forwards; animation-fill-mode: none;')!['fill'], 'none');
    assert.equal(specOf('animation: a 1s; animation-name: b;')!['name'], 'b');
  });

  it('are reset by a shorthand written after them', () => {
    const spec = specOf('animation-duration: 2s; animation-fill-mode: both; animation: spin 1s;')!;
    assert.equal(spec['duration'], 1000);
    assert.equal(spec['fill'], 'none');
  });

  it('take the first of a list when there is one name to pair it with', () => {
    // CSS sizes the lists by animation-name and ignores values beyond it.
    assert.equal(specOf('animation-name: a; animation-duration: 1s, 2s;')!['duration'], 1000);
  });

  it('refuse more than one name, as the shorthand refuses more than one animation', () => {
    assert.throws(() => sheet('view { animation-name: a, b; }'), /one animation/);
  });

  it('read the direction as the shorthand does', () => {
    const spec = sheet('view { animation-name: a; animation-direction: alternate; }').rules[0]!
      .declarations['$animation'] as { direction?: string };
    assert.equal(spec.direction, 'alternate');
  });

  it('read a paused play state, and leave running out as the default', () => {
    const spec = (css: string) =>
      sheet(css).rules[0]!.declarations['$animation'] as { paused?: boolean };
    assert.equal(spec('view { animation: spin 1s; animation-play-state: paused; }').paused, true);
    assert.equal(spec('view { animation: spin 1s paused; }').paused, true);
    assert.equal(spec('view { animation: spin 1s; }').paused, undefined);
  });

  it('report a refused part and keep the rest of the animation', () => {
    const reports: string[] = [];
    const compiled = compileCss(
      'view { animation: spin 1s; animation-name: spin, pulse; }',
      'app.css',
      { onUnsupported: (message: string) => reports.push(message) },
    ) as Sheet;
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /one animation per rule/);
    assert.equal((compiled.rules[0]!.declarations['$animation'] as { name: string }).name, 'spin');
  });

  it('turn the animation off with a name of none, in either spelling', () => {
    // Null rather than absent, so a stronger rule can stop a weaker rule's animation.
    assert.equal(specOf('animation-name: none;'), null);
    assert.equal(specOf('animation: none;'), null);
    assert.equal(specOf('animation: spin 1s; animation-name: none;'), null);
  });

  it('animate nothing without a name, as a browser does, and keep the timing for one that has', () => {
    const { declarations } = sheet('view { animation-duration: 1s; }').rules[0]!;
    assert.equal(declarations['$animation'], undefined);
    assert.equal(declarations['$animationDuration'], 1000);
  });
});

/**
 * The runtime half. The engine owns the clock so a test can step it exactly.
 */
describe('playing an animation', () => {
  function scene(css: string) {
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css) as never,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.appendChild(engine.root, view);
    engine.commit();

    return {
      engine,
      view,
      painted: (prop: string) => flatten(fabric.committed)[0]?.props[prop],
      tick(ms: number) {
        now += ms;
        engine.advanceAnimations();
        engine.commit();
      },
      classes(value: string) {
        engine.setClasses(view, value);
        engine.commit();
      },
    };
  }

  const css = `
    @keyframes rise {
      from { opacity: 0; width: 10px; }
      to { opacity: 1; width: 50px; }
    }
    view { opacity: 1; width: 100px; }
    view.enter { animation: rise 100ms linear; }
    view.held { animation: rise 100ms linear 0s 1 forwards; }
  `;

  it('holds its frame while paused, and carries on from there when it runs again', () => {
    const s = scene(`${css} view.enter.paused { animation-play-state: paused; }`);
    s.classes('enter');
    s.tick(40);
    assert.equal(s.painted('width'), 26, 'forty per cent of the way');
    s.classes('enter paused');
    s.tick(500);
    assert.equal(s.painted('width'), 26, 'held while paused, however long');
    s.classes('enter');
    assert.equal(s.painted('width'), 26, 'running again does not start it over');
    s.tick(30);
    assert.equal(s.painted('width'), 38, 'and it carries on from where it was');
  });

  it('starts paused at its first frame when it begins paused', () => {
    const s = scene(`${css} view.waiting { animation: rise 100ms linear paused; }`);
    s.classes('waiting');
    s.tick(80);
    assert.equal(s.painted('width'), 10);
  });

  it('eases a colour in premultiplied alpha, so transparent adds no black', () => {
    const s = scene(`
      @keyframes glow {
        from { background-color: transparent; }
        to { background-color: red; }
      }
      view.glowing { animation: glow 100ms linear; }
    `);
    s.classes('glowing');
    s.tick(50);
    assert.equal(s.painted('backgroundColor'), 'rgba(255, 0, 0, 0.5)');
  });

  it('plays from its own frames, not from what was on screen', () => {
    const s = scene(css);
    assert.equal(s.painted('opacity'), 1, 'resting');

    s.classes('enter');
    assert.equal(s.painted('opacity'), 0, 'the first frame wins immediately');
    assert.equal(s.painted('width'), 10);
  });

  it('plays an animation written in longhands, and a stronger rule naming none stops it', () => {
    const s = scene(`
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
      view { opacity: 1; }
      view.enter { animation-name: rise; animation-duration: 100ms; animation-timing-function: linear; }
      view.enter.still { animation-name: none; }
    `);
    s.classes('enter');
    s.tick(50);
    assert.equal(s.painted('opacity'), 0.5);
    s.classes('enter still');
    assert.equal(s.painted('opacity'), 1, 'back to the resting style');
  });

  describe('cascades each part on its own, as a browser does', () => {
    const parts = `
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes grow { from { width: 10px; } to { width: 50px; } }
      view { opacity: 1; width: 100px; }
      view.a { animation: fade 100ms linear infinite; }
    `;

    it('keeps a weaker rule timing when a stronger rule names another animation', () => {
      const s = scene(`${parts} view.a.b { animation-name: grow; }`);
      s.classes('a b');
      s.tick(50);
      assert.equal(s.painted('width'), 30, 'grow, over the 100ms the weaker rule gave it');
      assert.equal(s.painted('opacity'), 1, 'and not fade');
      s.tick(100);
      assert.equal(s.painted('width'), 30, 'still repeating, as infinite says');
    });

    it('keeps a weaker rule name when a stronger rule sets only the timing', () => {
      const s = scene(`${parts} view.a.slow { animation-duration: 200ms; }`);
      s.classes('a slow');
      s.tick(50);
      assert.equal(s.painted('opacity'), 0.25);
    });

    it('lets a stronger shorthand reset a weaker rule longhand', () => {
      const s = scene(`
        @keyframes grow { from { width: 10px; } to { width: 50px; } }
        view { width: 100px; }
        view.slow { animation-duration: 1s; animation-iteration-count: infinite; }
        view.slow.a { animation: grow 100ms linear; }
      `);
      s.classes('slow a');
      s.tick(50);
      assert.equal(s.painted('width'), 30, 'the shorthand duration');
      s.tick(100);
      assert.equal(s.painted('width'), 100, 'played once: the shorthand reset the count');
    });
  });

  it('plays the frames backwards in reverse', () => {
    const s = scene(`
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
      view { opacity: 1; }
      view.enter { animation: rise 100ms linear reverse; }
    `);
    s.classes('enter');
    assert.equal(s.painted('opacity'), 1, 'from the last frame');
    s.tick(25);
    assert.equal(s.painted('opacity'), 0.75);
  });

  it('goes there and back with alternate, and starts back with alternate-reverse', () => {
    const s = scene(`
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
      view { opacity: 0.5; }
      view.there { animation: rise 100ms linear infinite alternate; }
      view.back { animation: rise 100ms linear infinite alternate-reverse; }
    `);
    s.classes('there');
    s.tick(25);
    assert.equal(s.painted('opacity'), 0.25, 'the first iteration forwards');
    s.tick(100);
    assert.equal(s.painted('opacity'), 0.75, 'the second backwards');
    s.classes('back');
    s.tick(25);
    assert.equal(s.painted('opacity'), 0.75, 'alternate-reverse starts backwards');
  });

  it('holds the frame the last iteration ended on, whichever way it ran', () => {
    const s = scene(`
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
      view { opacity: 0.5; }
      view.enter { animation: rise 100ms linear 2 alternate forwards; }
    `);
    s.classes('enter');
    s.tick(250);
    assert.equal(s.painted('opacity'), 0, 'two iterations, the second backwards, ends at from');
  });

  it('holds the frame a fractional count ends on, part of the way through its last iteration', () => {
    const s = scene(`
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
      view { opacity: 0.5; }
      view.enter { animation: rise 100ms linear 1.5 forwards; }
    `);
    s.classes('enter');
    s.tick(250);
    assert.equal(s.painted('opacity'), 0.5, 'half way through the second iteration');
  });

  it('interpolates each property across the frames', () => {
    const s = scene(css);
    s.classes('enter');
    s.tick(50);
    assert.equal(s.painted('opacity'), 0.5);
    assert.equal(s.painted('width'), 30);
  });

  it('falls back to the resting style when it ends without a fill mode', () => {
    const s = scene(css);
    s.classes('enter');
    s.tick(120);
    assert.equal(s.painted('opacity'), 1, 'the rule says 1, and nothing is filling it any more');
    assert.equal(s.painted('width'), 100, 'not the 50 the last frame held');
    assert.equal(s.engine.animating, false);
  });

  it('holds the last frame with `forwards`', () => {
    const s = scene(css);
    s.classes('held');
    s.tick(120);
    assert.equal(s.painted('width'), 50, 'the last frame, not the rule');
  });

  it('keeps the resting style through the delay, then plays from the first frame', () => {
    const s = scene(`${css} view.late { animation: rise 100ms linear 50ms; }`);
    s.classes('late');
    assert.equal(s.painted('opacity'), 1, 'the rule, since nothing fills backwards');
    s.tick(25);
    assert.equal(s.painted('opacity'), 1);
    s.tick(75);
    assert.equal(s.painted('opacity'), 0.5, 'halfway through, once the delay is up');
  });

  it('shows the first frame through the delay with `backwards`', () => {
    const s = scene(`${css} view.late { animation: rise 100ms linear 50ms 1 backwards; }`);
    s.classes('late');
    assert.equal(s.painted('opacity'), 0);
    s.tick(25);
    assert.equal(s.painted('opacity'), 0);
  });

  it('holds the last frame with `both`, which fills the end as well as the start', () => {
    const s = scene(`${css} view.both { animation: rise 100ms linear 0s 1 both; }`);
    s.classes('both');
    s.tick(120);
    assert.equal(s.painted('width'), 50);
  });

  it('starts again from its first frame when a rule gives the same name new timing', () => {
    const s = scene(`${css} view.slow { animation: rise 200ms linear; }`);
    s.classes('enter');
    s.tick(50);
    assert.equal(s.painted('opacity'), 0.5);
    s.classes('slow');
    assert.equal(s.painted('opacity'), 0, 'restarted, not carried on at the old timing');
    s.tick(100);
    assert.equal(s.painted('opacity'), 0.5, 'halfway through the new 200ms');
  });

  it('falls back to the resting style when it ends with `backwards`, which fills the start only', () => {
    // Only 'none' let go at the end, so 'backwards' held the last frame as 'both' does.
    const s = scene(`${css} view.early { animation: rise 100ms linear 0s 1 backwards; }`);
    s.classes('early');
    s.tick(120);
    assert.equal(s.painted('width'), 100, 'the rule, not the 50 the last frame held');
  });

  /**
   * A transform across frames, driven through the engine rather than through `interpolate` alone.
   *
   * This is the shape a pulse or a pop is written in, and it used to step: the frames were read
   * correctly and every intermediate commit held the previous frame's transform, so the thing
   * jumped between keyframes instead of moving through them.
   */
  it('moves a transform through the frames rather than stepping between them', () => {
    const s = scene(`
      @keyframes pulse {
        from { transform: scale(0.8); }
        to { transform: scale(1.2); }
      }
      view.pulsing { animation: pulse 100ms linear; }
    `);

    // CSS's one-argument `scale()` means both axes, and RN spells those separately.
    s.classes('pulsing');
    assert.deepEqual(s.painted('transform'), [{ scaleX: 0.8 }, { scaleY: 0.8 }], 'the first frame');

    s.tick(50);
    assert.deepEqual(
      s.painted('transform'),
      [{ scaleX: 1 }, { scaleY: 1 }],
      'halfway, not still at 0.8',
    );

    s.tick(25);
    assert.deepEqual(s.painted('transform'), [{ scaleX: 1.1 }, { scaleY: 1.1 }]);
  });

  it('reports itself by name while it runs, which is how animate.enter waits', () => {
    const s = scene(css);
    s.classes('enter');
    const running = s.view as unknown as { getAnimations(): { animationName?: string }[] };
    assert.deepEqual(
      running.getAnimations().map((a) => a.animationName),
      ['rise'],
    );
    s.tick(120);
    assert.deepEqual(running.getAnimations(), []);
  });

  it('announces its start and its end', () => {
    const s = scene(css);
    const seen: string[] = [];
    s.engine.setEventListener(s.view, 'topAnimationstart', (e) =>
      seen.push(`start:${(e as { animationName: string }).animationName}`),
    );
    s.engine.setEventListener(s.view, 'topAnimationend', (e) =>
      seen.push(`end:${(e as { animationName: string }).animationName}`),
    );

    s.classes('enter');
    assert.deepEqual(seen, ['start:rise']);
    s.tick(120);
    assert.deepEqual(seen, ['start:rise', 'end:rise']);
  });

  /**
   * `infinite` reaches the device as `null`, because the sheet is JSON and `JSON.stringify` has
   * no way to write an infinity. The runtime multiplied the duration by it, got a total of zero,
   * and treated the animation as finished before its first frame: it painted its last frame once
   * and stopped. Nothing caught it because the compile-time test held the in-memory value and
   * never made the trip through JSON that a bundle does.
   */
  /**
   * The `animate.enter` shape: slide up from below while fading in.
   *
   * Reported as "it appears too low and then jumps up at the end", which is what a stepped
   * transform looks like - the element holds the first frame's offset for the whole duration and
   * arrives in one frame. The opacity faded correctly throughout, which is what made it look like
   * an easing problem rather than a missing interpolation.
   */
  it('slides a translate through the frames, as an entering element does', () => {
    const s = scene(`
      @keyframes arrive {
        from { opacity: 0; transform: translateY(16px) }
        to { opacity: 1; transform: translateY(0) }
      }
      view.arriving { animation: arrive 100ms linear }
    `);

    s.classes('arriving');
    assert.deepEqual(s.painted('transform'), [{ translateY: 16 }], 'starts below');

    s.tick(50);
    assert.deepEqual(s.painted('transform'), [{ translateY: 8 }], 'and is halfway up at halfway');
    assert.equal(s.painted('opacity'), 0.5);

    s.tick(25);
    assert.deepEqual(s.painted('transform'), [{ translateY: 4 }]);
  });

  it('keeps running when the count is infinite', () => {
    const s = scene(`
      @keyframes fade { from { opacity: 0.25 } to { opacity: 1 } }
      view { opacity: 1 }
      view.forever { animation: fade 100ms linear infinite }
    `);

    s.classes('forever');
    assert.equal(s.painted('opacity'), 0.25, 'the first frame, not the last');

    s.tick(50);
    assert.equal(s.painted('opacity'), 0.625);
    assert.equal(s.engine.animating, true);

    // Round again rather than settling.
    s.tick(75);
    assert.equal(s.painted('opacity'), 0.4375);
    assert.equal(s.engine.animating, true, 'still going after a full pass');
  });

  it('repeats for the count it was given', () => {
    const s = scene(`
      @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
      view { opacity: 1; }
      view.twice { animation: rise 100ms linear 0s 2; }
    `);
    s.classes('twice');
    s.tick(150);
    assert.equal(s.painted('opacity'), 0.5, 'halfway through the second pass');
    assert.equal(s.engine.animating, true);
    s.tick(60);
    assert.equal(s.engine.animating, false);
  });
});

describe('an animation against an inline style', () => {
  /**
   * A drawer slides in with `@keyframes`, and follows a finger with an inline `transform`. Both
   * want the same property, and at rest the inline one has nothing to say - so it must not be the
   * one that speaks.
   *
   * It was. The component bound `[style]="{ transform: dragOffset }"` with the offset undefined
   * until a drag begins, Angular wrote that as a cleared property on every commit, and the
   * entrance animation was overwritten a frame after it started. On a phone the backdrop faded in
   * and the sheet simply appeared, which reads as "the animation does not work" rather than as two
   * things writing to one property.
   */
  function scene(css: string) {
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css) as never,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.appendChild(engine.root, view);
    return {
      engine,
      view,
      painted: (prop: string) => flatten(fabric.committed)[0]?.props[prop],
      tick(ms: number) {
        now += ms;
        engine.advanceAnimations();
        engine.commit();
      },
    };
  }

  const SHEET = `
    @keyframes slide-up {
      from { transform: translateY(100%); }
      to { transform: translateY(0%); }
    }
    .sliding { animation: slide-up 300ms linear; }
  `;

  it('animates the property when nothing inline claims it', () => {
    const s = scene(SHEET);
    s.engine.setClasses(s.view, 'sliding');
    s.engine.commit();
    s.tick(150);
    assert.deepEqual(s.painted('transform'), [{ translateY: '50%' }], 'halfway up');
  });

  it('wins over an inline value while it is running, as CSS says', () => {
    /*
     * A running animation sits above the inline layer in the cascade, and it does here too.
     *
     * Worth knowing rather than worth changing: a drawer dragged during its own 300ms entrance is
     * ignored until the entrance finishes. That is a real if narrow gap, and the alternative -
     * inline beating the animation - would mean a component that binds a property it is not using
     * yet silently cancels its own entrance, which is the larger and much quieter bug.
     */
    const s = scene(SHEET);
    s.engine.setClasses(s.view, 'sliding');
    s.engine.setProp(s.view, 'transform', [{ translateY: 20 }]);
    s.engine.commit();
    s.tick(150);
    assert.deepEqual(s.painted('transform'), [{ translateY: '50%' }]);
  });

  it('hands the property back when it finishes', () => {
    const s = scene(SHEET);
    s.engine.setClasses(s.view, 'sliding');
    s.engine.setProp(s.view, 'transform', [{ translateY: 20 }]);
    s.engine.commit();
    s.tick(300);
    assert.deepEqual(s.painted('transform'), [{ translateY: 20 }], 'the drag, once it is over');
  });
});

describe('an animation against an important declaration', () => {
  /**
   * An important author declaration sits above the animation in the cascade, so the animation
   * does not move that property. A transition sits above both, so it still eases one.
   */
  function scene(css: string, initial = '') {
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css) as never,
      now: () => now,
    });
    const view = engine.createElement('view');
    if (initial) engine.setClasses(view, initial);
    engine.appendChild(engine.root, view);
    engine.commit();
    return {
      painted: (prop: string) => flatten(fabric.committed)[0]?.props[prop],
      tick(ms: number) {
        now += ms;
        engine.advanceAnimations();
        engine.commit();
      },
      classes(value: string) {
        engine.setClasses(view, value);
        engine.commit();
      },
    };
  }

  const FADE =
    '@keyframes fade { from { opacity: 0; width: 0px } to { opacity: 1; width: 100px } }';

  it('leaves the important property where it is declared, as a browser does', () => {
    const s = scene(`${FADE} view { opacity: 0.3 !important; animation: fade 100ms linear }`);
    s.tick(50);
    assert.equal(s.painted('opacity'), 0.3);
  });

  it('still animates the properties that are not important', () => {
    const s = scene(`${FADE} view { opacity: 0.3 !important; animation: fade 100ms linear }`);
    s.tick(50);
    assert.equal(s.painted('width'), 50);
  });

  it('animates the property once the important declaration goes', () => {
    const s = scene(
      `${FADE} view { animation: fade 100ms linear } view.pinned { opacity: 0.3 !important }`,
      'pinned',
    );
    s.tick(25);
    assert.equal(s.painted('opacity'), 0.3);
    s.classes('');
    s.tick(25);
    assert.equal(s.painted('opacity'), 0.5);
  });

  it('lets a transition ease an important property, which it sits above', () => {
    const s = scene(
      'view { opacity: 1 !important; transition: opacity 100ms linear } view.dim { opacity: 0 !important }',
    );
    s.classes('dim');
    s.tick(50);
    assert.equal(s.painted('opacity'), 0.5);
  });
});

describe('a keyframe list that anchors to nothing', () => {
  /**
   * `animate-pulse` is one frame: `50% { opacity: 0.5 }`. CSS fills in the missing 0% and 100%
   * with the value the element would otherwise have - and for a skeleton, which never writes an
   * opacity of its own, that value is the property's initial one rather than nothing.
   *
   * Anchoring to nothing made the pulse hold at whatever it started with and jump, which is what
   * "the animation looks wrong" turned out to be.
   */
  function scene(css: string) {
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css) as never,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.appendChild(engine.root, view);
    return {
      engine,
      view,
      painted: (prop: string) => flatten(fabric.committed)[0]?.props[prop],
      tick(ms: number) {
        now += ms;
        engine.advanceAnimations();
        engine.commit();
      },
    };
  }

  const PULSE = `
    @keyframes pulse { 50% { opacity: 0.5; } }
    .pulsing { animation: pulse 1000ms linear infinite; }
  `;

  it('fades to the middle frame and back, from an opacity nothing declared', () => {
    const s = scene(PULSE);
    s.engine.setClasses(s.view, 'pulsing');
    s.engine.commit();

    s.tick(250);
    assert.equal(s.painted('opacity'), 0.75, 'halfway to the dip, from a full 1');
    s.tick(250);
    assert.equal(s.painted('opacity'), 0.5, 'the frame that was written down');
    s.tick(250);
    assert.equal(s.painted('opacity'), 0.75, 'and back up again');
  });

  it('anchors to the value the element does declare, when it declares one', () => {
    // The implicit frames are the element's own value, not a constant: a half-faded skeleton
    // pulses between 0.6 and 0.5, not between 1 and 0.5.
    const s = scene(`
      @keyframes pulse { 50% { opacity: 0.5; } }
      .pulsing { opacity: 0.6; animation: pulse 1000ms linear infinite; }
    `);
    s.engine.setClasses(s.view, 'pulsing');
    s.engine.commit();
    s.tick(250);
    assert.equal(s.painted('opacity'), 0.55);
  });

  it('anchors a background colour nothing declared to transparent', () => {
    const s = scene(`
      @keyframes flash { 50% { background-color: red; } }
      .flashing { animation: flash 1000ms linear; }
    `);
    s.engine.setClasses(s.view, 'flashing');
    s.engine.commit();
    s.tick(250);
    // Mixed with its alpha multiplied in, as a browser does: red at half strength, not a dark red.
    assert.equal(s.painted('backgroundColor'), 'rgba(255, 0, 0, 0.5)');
  });

  it('anchors a padding, a margin and a corner radius nothing declared to 0', () => {
    const s = scene(`
      @keyframes open { to { padding-top: 20px; margin-top: 20px; border-top-left-radius: 20px; } }
      .opening { animation: open 100ms linear; }
    `);
    s.engine.setClasses(s.view, 'opening');
    s.engine.commit();
    s.tick(50);
    assert.equal(s.painted('paddingTop'), 10);
    assert.equal(s.painted('marginTop'), 10);
    assert.equal(s.painted('borderTopLeftRadius'), 10);
  });

  it('eases a corner radius nothing declared from 0 to a percentage', () => {
    const s = scene(`
      @keyframes round { to { border-top-left-radius: 50%; } }
      .rounding { animation: round 100ms linear; }
    `);
    s.engine.setClasses(s.view, 'rounding');
    s.engine.commit();
    s.tick(50);
    assert.equal(s.painted('borderTopLeftRadius'), '25%');
  });
});

describe('a keyframe with a declaration it cannot compile', () => {
  // A declaration in a frame is dropped the way one in a rule is, and the animation survives. It
  // used to take the whole `@keyframes` with it, where the same declaration in a rule cost only
  // itself.
  it('keeps the animation, without that declaration', () => {
    const dropped: string[] = [];
    const sheet = compileCss(
      '@keyframes k { from { opacity: 0; float: left } to { opacity: 1 } }',
      'frames',
      { onUnsupported: (message: string) => dropped.push(message) },
    );
    assert.deepEqual(sheet.keyframes.k, [
      { offset: 0, declarations: { opacity: 0 } },
      { offset: 1, declarations: { opacity: 1 } },
    ]);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!, /dropped 'float'/);
  });

  it('keeps a value only the device can settle, for the element that plays the frame', () => {
    // A var(), an em or a viewport unit is settled against a node, and a frame has the one
    // that plays it: each used to leave the frame empty, and the animation ran without moving.
    const kept = (css: string) =>
      compileCss(css).keyframes.k[0].deferred.map((one: { props: string[] }) => one.props);
    assert.deepEqual(kept('@keyframes k { to { width: 10vw } }'), [['width']]);
    assert.deepEqual(kept('@keyframes k { to { opacity: var(--o) } }'), [['opacity']]);
    assert.deepEqual(kept('@keyframes k { to { transform: translateX(1em) } }'), [['transform']]);
    const [frame] = compileCss('@keyframes k { to { opacity: 1; padding-top: 1em } }').keyframes.k;
    assert.deepEqual(frame.declarations, { opacity: 1 });
    assert.deepEqual(
      frame.deferred.map((one: { props: string[] }) => one.props),
      [['paddingTop']],
    );
  });
});

describe("a keyframe's own timing function", () => {
  // CSS eases each keyframe to the next by the `animation-timing-function` written in it, which
  // is how Tailwind's `animate-bounce` falls fast and rises slow. It was kept under a key that
  // does not survive being written into a module, and eased by nothing on device.
  const css = `
    @keyframes drop {
      from { width: 0px; animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
      50% { width: 100px; animation-timing-function: linear; }
      to { width: 0px; }
    }
    view { animation: drop 200ms ease; }
  `;

  it('compiles the timing function onto the frame it is written in', () => {
    const frames = sheet(css).keyframes!['drop']!;
    assert.deepEqual(
      frames.map((frame) => (frame as Frame & { easing?: number[] }).easing),
      [[0.8, 0, 1, 1], [0, 0, 1, 1], undefined],
    );
    // As the module Metro writes carries it: JSON, which keeps nothing a frame holds off its keys.
    const written = JSON.parse(JSON.stringify(sheet(css))) as ReturnType<typeof sheet>;
    assert.deepEqual(
      written.keyframes!['drop']!.map((frame) => (frame as Frame & { easing?: number[] }).easing),
      [[0.8, 0, 1, 1], [0, 0, 1, 1], undefined],
    );
    assert.equal(JSON.stringify(sheet(css)).includes('timing'), false, 'nothing left unfinished');
    assert.deepEqual(Object.getOwnPropertySymbols(frames[0]!.declarations), []);
  });

  it('eases each stretch by the frame it starts at', () => {
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css) as never,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.appendChild(engine.root, view);
    engine.commit();
    const width = () => flatten(fabric.committed)[0]?.props['width'] as number;
    now += 50;
    engine.advanceAnimations();
    engine.commit();
    // Halfway through the first stretch, on a curve that starts slow: well short of 50.
    assert.ok(width() < 25, `the first frame's curve, not the animation's ease: ${width()}`);
    now += 100;
    engine.advanceAnimations();
    engine.commit();
    assert.equal(Math.round(width()), 50, 'halfway down the linear stretch');
  });
});

describe('an animation none of whose frames says anything', () => {
  // A keyframe whose only declaration was refused at build time, as one native has no prop for is.
  const EMPTY = '@keyframes idle { from { float: left } }';

  function idle(animation: string) {
    let now = 1000;
    const fabric = createFakeFabric();
    const sheet = compileCss(`${EMPTY} .a { animation: ${animation} }`, 'app.css', {
      onUnsupported: () => {},
    });
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never, now: () => now });
    const view = engine.createElement('view');
    engine.setClasses(view, 'a');
    engine.appendChild(engine.root, view);
    const events: string[] = [];
    for (const name of ['topAnimationstart', 'topAnimationend']) {
      engine.setEventListener(view, name, () => void events.push(name.slice(3).toLowerCase()));
    }
    engine.commit();
    const frame = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    return { engine, fabric, events, frame, sheet };
  }

  it('commits no frame of it, and is over with at once where it never ends', () => {
    const s = idle('idle 250ms linear infinite');
    assert.deepEqual(s.events, ['animationstart']);
    const commits = s.fabric.calls.completeRoot;
    for (let i = 0; i < 5; i++) s.frame(16);
    assert.equal(s.fabric.calls.completeRoot, commits);
    assert.equal(s.engine.animating, false, 'nothing left for a frame loop to run for');
  });

  it('still ends when its time is up, having committed nothing on the way', () => {
    const s = idle('idle 100ms linear');
    const commits = s.fabric.calls.completeRoot;
    s.frame(50);
    assert.equal(s.engine.animating, true);
    assert.equal(s.fabric.calls.completeRoot, commits);
    s.frame(60);
    assert.deepEqual(s.events, ['animationstart', 'animationend']);
    assert.equal(s.engine.animating, false);
  });

  it('ends at once where it takes no time, endless or not', () => {
    const s = idle('idle 0s linear infinite');
    s.frame(16);
    assert.deepEqual(s.events, ['animationstart', 'animationend']);
    assert.equal(s.engine.animating, false);
  });

  it('plays on once a hot swap gives its keyframes something to say', () => {
    const s = idle('idle 250ms linear infinite');
    s.frame(16);
    assert.equal(s.engine.animating, false);
    const edited = compileCss(
      '@keyframes idle { from { opacity: 0 } } .a { animation: idle 250ms linear infinite }',
      'app.css',
    );
    s.engine.addGlobalSheet(edited as never, s.sheet as never);
    s.engine.commit();
    assert.equal(s.engine.animating, true);
    const opacity = () => s.fabric.committed[0]!.props['opacity'];
    s.frame(50);
    const first = opacity();
    s.frame(50);
    assert.notEqual(opacity(), first, 'a frame further on, not the one the swap committed');
  });
});

describe('an animation with no fill, at its end', () => {
  const FADE = '@keyframes leave { from { opacity: 1 } to { opacity: 0 } } .a { opacity: 1 }';

  function leaving() {
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(
        `${FADE} .out { animation: leave 100ms linear }`,
        'app.css',
      ) as never,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'a');
    engine.appendChild(engine.root, view);
    engine.commit();
    const frame = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    /** The opacity of each frame committed while the view is there, and `gone` once it is not. */
    const seen: unknown[] = [];
    const look = () =>
      seen.push(fabric.committed[0] ? fabric.committed[0].props['opacity'] : 'gone');
    return { engine, view, frame, seen, look };
  }

  it('stays at its last frame until its animationend is heard, and is taken away from there', () => {
    // A browser runs the listener before it paints again, so an overlay that fades out and is
    // removed on `animationend` is never seen back at rest. One frame at rest is a flash.
    const s = leaving();
    s.engine.setEventListener(s.view, 'topAnimationend', () =>
      s.engine.removeChild(s.engine.root, s.view),
    );
    s.engine.setClasses(s.view, 'a out');
    s.engine.commit();
    for (let i = 0; i < 4; i++) {
      s.frame(50);
      s.look();
    }
    assert.deepEqual(s.seen, [0.5, 0, 'gone', 'gone']);
  });

  it('goes back to rest once the listener has run and left it there', () => {
    const s = leaving();
    let heard = 0;
    s.engine.setEventListener(s.view, 'topAnimationend', () => heard++);
    s.engine.setClasses(s.view, 'a out');
    s.engine.commit();
    for (let i = 0; i < 3; i++) {
      s.frame(50);
      s.look();
    }
    assert.equal(heard, 1);
    assert.deepEqual(s.seen, [0.5, 0, 1]);
  });

  it('is back at rest at once where nothing listens for its end', () => {
    const s = leaving();
    s.engine.setClasses(s.view, 'a out');
    s.engine.commit();
    for (let i = 0; i < 2; i++) {
      s.frame(50);
      s.look();
    }
    assert.deepEqual(s.seen, [0.5, 1]);
  });

  it('goes back to rest where the one listening throws, and the rest still hear it', () => {
    const s = leaving();
    const reported: unknown[] = [];
    s.engine.setOnError((error) => reported.push(error));
    let heard = 0;
    s.engine.setEventListener(s.view, 'topAnimationend', () => {
      throw new Error('listener');
    });
    s.engine.setEventListener(s.view, 'topAnimationend', () => heard++);
    s.engine.setClasses(s.view, 'a out');
    s.engine.commit();
    for (let i = 0; i < 3; i++) {
      s.frame(50);
      s.look();
    }
    assert.deepEqual(s.seen, [0.5, 0, 1], 'held for the commit it ended in, and let go after');
    assert.equal(heard, 1);
    assert.equal(reported.length, 1);
  });

  it('is back at rest at once where the one that listened has stopped', () => {
    const s = leaving();
    const stop = s.engine.setEventListener(s.view, 'topAnimationend', () => {});
    stop();
    s.engine.setClasses(s.view, 'a out');
    s.engine.commit();
    for (let i = 0; i < 2; i++) {
      s.frame(50);
      s.look();
    }
    assert.deepEqual(s.seen, [0.5, 1]);
  });
});

describe('an animation it cannot compile', () => {
  // The animation is put together once the rule is read, and a step easing refused there took the
  // whole rule with it, where a declaration it cannot compile costs only itself.
  const SPIN = '@keyframes spin { to { transform: rotate(360deg) } }';
  const compiled = (css: string) => {
    const reports: string[] = [];
    const sheet = compileCss(css, 'app.css', {
      onUnsupported: (message: string) => reports.push(message),
    }) as Sheet;
    return { sheet, declarations: sheet.rules[0]?.declarations, reports };
  };

  it('drops only the animation, and says it was the animation', () => {
    for (const easing of ['steps(8, end)', 'step-start', 'step-end']) {
      const { declarations, reports } = compiled(
        `${SPIN} .spinner { width: 24px; height: 24px; animation: spin 1s ${easing} infinite }`,
      );
      assert.deepEqual(declarations, { width: 24, height: 24 }, easing);
      assert.equal(reports.length, 1, easing);
      assert.match(reports[0]!, /^app\.css:1: dropped 'animation': 'steps' easing/, easing);
    }
  });

  it('drops the animation a step easing is a longhand of, where the rule names one', () => {
    const { declarations, reports } = compiled(
      `${SPIN} .spinner { width: 24px; animation-name: spin; animation-duration: 1s; ` +
        'animation-timing-function: steps(8) }',
    );
    assert.deepEqual(declarations, { width: 24 });
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /dropped 'animation': 'steps' easing/);
  });

  it('drops only the timing function where the rule names no animation', () => {
    // The rule plays nothing itself: its duration is for an animation another rule names.
    const { declarations, reports } = compiled(
      '.slow { width: 24px; animation-duration: 2s; animation-timing-function: step-end }',
    );
    assert.deepEqual(declarations, { width: 24, $animationDuration: 2000 });
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /dropped 'animation-timing-function': 'steps' easing/);
  });

  it('keeps animation-name: none, which stops a weaker rule, when its timing is refused', () => {
    const { declarations, reports } = compiled(
      '.still { width: 24px; animation-name: none; animation-timing-function: steps(2) }',
    );
    assert.equal(declarations!['$animation'], null);
    assert.equal('$animation' in declarations!, true);
    assert.equal(declarations!['width'], 24);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /dropped 'animation-timing-function': 'steps' easing/);
  });

  it('drops the keyframes a step timing function is written in, rather than play them eased', () => {
    const { sheet, reports } = compiled(
      '@keyframes k { from { opacity: 0; animation-timing-function: steps(2) } to { opacity: 1 } }',
    );
    assert.equal(sheet.keyframes?.['k'], undefined);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /^app\.css:1 \(@keyframes k\): dropped a rule: 'steps' easing/);
  });

  it('still compiles an animation with an easing it can draw', () => {
    const { declarations, reports } = compiled(
      `${SPIN} .spinner { width: 24px; animation: spin 1s linear infinite }`,
    );
    assert.deepEqual(reports, []);
    assert.equal(declarations!['width'], 24);
    assert.deepEqual(declarations!['$animation'], {
      name: 'spin',
      duration: 1000,
      delay: 0,
      easing: [0, 0, 1, 1],
      iterations: null,
      fill: 'none',
    });
  });
});

describe('keyframes two components each name the same', () => {
  it("plays each component's own for its elements, as Angular scopes them in a browser", () => {
    // An accordion and a collapsible each write `@keyframes slideDown`, to a height of their
    // own. The last sheet read would otherwise have both play its frames.
    const sheet = (to: number) =>
      compileCss(
        `@keyframes k { from { opacity: 0 } to { opacity: ${to} } } .a { animation: k 100ms linear forwards }`,
        `to-${to}.css`,
      );
    let now = 1000;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { now: () => now });
    for (const to of [0.4, 0.8]) {
      const view = engine.createElement('view', sheet(to) as never);
      engine.setClasses(view, 'a');
      engine.appendChild(engine.root, view);
    }
    engine.commit();
    now += 100;
    engine.advanceAnimations();
    engine.commit();
    assert.deepEqual(
      fabric.committed.map((view) => view.props['opacity']),
      [0.4, 0.8],
    );
  });
});

describe('a keyframe that is written with a var()', () => {
  // A panel that opens to the height its library measured: `to { height: var(--h) }`. A
  // browser settles the frame against the element that plays it, and so does the engine.
  const OPEN =
    '@keyframes open { from { height: 0 } to { height: var(--h) } }' +
    ' .a { height: 0; animation: open 200ms linear forwards }';

  function opened() {
    let now = 1000;
    const fabric = createFakeFabric();
    const sheet = compileCss(OPEN, 'app.css');
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never, now: () => now });
    const view = engine.createElement('view');
    engine.setClasses(view, 'a');
    engine.appendChild(engine.root, view);
    const frame = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    const height = () => fabric.committed[0]!.props['height'];
    return { engine, view, frame, height };
  }

  it('is kept for the engine to settle', () => {
    const [, to] = compileCss(OPEN, 'app.css').keyframes.open;
    assert.deepEqual(
      to.deferred.map((one: { props: string[] }) => one.props),
      [['height']],
    );
  });

  it('plays to the value its element has for the variable', () => {
    const s = opened();
    s.engine.setCustomProperty(s.view, '--h', '58px');
    s.engine.commit();
    assert.equal(s.height(), 0);
    s.frame(100);
    assert.equal(s.height(), 29);
    s.frame(100);
    assert.equal(s.height(), 58);
  });

  it('follows a variable set once it is under way, and one that changes', () => {
    const s = opened();
    s.engine.commit();
    s.frame(50);
    assert.equal(s.height(), 0, 'nowhere to go yet');
    s.engine.setCustomProperty(s.view, '--h', '80px');
    s.frame(50);
    assert.equal(s.height(), 40, 'halfway, by the clock it started on');
    s.engine.setCustomProperty(s.view, '--h', '40px');
    s.frame(50);
    assert.equal(s.height(), 30);
  });
});

describe('an animation whose every part is a token, as tw-animate-css writes one', () => {
  // `animate-in fade-in-0 zoom-in-95 duration-300`: one shorthand that reads each part from a
  // token, and one `@keyframes enter` whose first frame reads where it comes in from. The
  // utilities beside it set the tokens.
  const CSS = `
    @keyframes enter {
      from {
        opacity: var(--tw-enter-opacity,1);
        transform: translate3d(var(--tw-enter-translate-x,0),var(--tw-enter-translate-y,0),0)scale3d(var(--tw-enter-scale,1),var(--tw-enter-scale,1),var(--tw-enter-scale,1))rotate(var(--tw-enter-rotate,0));
      }
    }
    .in { animation: enter var(--tw-animation-duration,var(--tw-duration,.15s))var(--tw-ease,ease)var(--tw-animation-delay,0s)var(--tw-animation-iteration-count,1)var(--tw-animation-direction,normal)var(--tw-animation-fill-mode,none); }
    .fade { --tw-enter-opacity: 0; }
    .zoom { --tw-enter-scale: .5; }
    .slow { --tw-duration: 300ms; }
    .late { --tw-animation-delay: 100ms; }
  `;

  function entering(classes: string) {
    let now = 1000;
    const dropped: string[] = [];
    const sheet = compileCss(CSS, 'app.css', { onUnsupported: (m: string) => dropped.push(m) });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never, now: () => now });
    const view = engine.createElement('view');
    engine.setClasses(view, classes);
    engine.appendChild(engine.root, view);
    engine.commit();
    const frame = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    const props = () => fabric.committed[0]!.props;
    return { dropped, frame, props, sheet };
  }

  it('compiles, with nothing of it dropped', () => {
    assert.deepEqual(entering('in').dropped, []);
  });

  it('gives a token the time its place says: the first is how long, the second the wait', () => {
    // Beside a time that is written out, the token after it is the delay.
    const css =
      '@keyframes k { from { opacity: 0 } } .a { animation: k 1s var(--wait, 100ms) }' +
      ' .b { animation: k var(--long, 1s) 100ms } .slow { --wait: 300ms; --long: 2s }';
    const spec = (classes: string) => {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as never });
      const view = engine.createElement('view');
      engine.setClasses(view, classes);
      engine.appendChild(engine.root, view);
      engine.commit();
      const { duration, delay } = view.playing!.spec;
      return [duration, delay];
    };
    assert.deepEqual(spec('a'), [1000, 100]);
    assert.deepEqual(spec('a slow'), [1000, 300]);
    assert.deepEqual(spec('b'), [1000, 100]);
    assert.deepEqual(spec('b slow'), [2000, 100]);
  });

  it('leaves a token that is the whole animation to be read where it is set', () => {
    // `animation: var(--motion, none)`: what the token holds is the animation, name and all.
    const css =
      '@keyframes k { from { opacity: 0 } } .a { animation: var(--motion, none) }' +
      ' .on { --motion: k 200ms linear }';
    const playing = (classes: string) => {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as never });
      const view = engine.createElement('view');
      engine.setClasses(view, classes);
      engine.appendChild(engine.root, view);
      engine.commit();
      return view.playing?.spec.name;
    };
    assert.equal(playing('a'), undefined);
    assert.equal(playing('a on'), 'k');
  });

  it('comes in from what the utilities beside it say, over the time they say', () => {
    const s = entering('in fade zoom slow');
    assert.equal(s.props()['opacity'], 0);
    const moved = s.props()['transform'] as unknown[];
    assert.deepEqual(moved.slice(2, 4), [{ scaleX: 0.5 }, { scaleY: 0.5 }]);
    s.frame(300);
    assert.equal(s.props()['opacity'] ?? 1, 1);
  });

  it('takes the time it falls back to where no utility sets one, and waits where one says to', () => {
    const quick = entering('in fade');
    quick.frame(150);
    assert.equal(quick.props()['opacity'] ?? 1, 1, 'over in 150ms');
    const late = entering('in fade late');
    late.frame(100);
    assert.equal(late.props()['opacity'], 0, 'held through its delay');
    late.frame(150);
    assert.equal(late.props()['opacity'] ?? 1, 1);
  });
});
