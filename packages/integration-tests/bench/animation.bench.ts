/**
 * The renderer's cost of an animation driven from JavaScript, in Node, against a Fabric that does
 * nothing: 2,000 views whose bound styles all change every frame, as a `requestAnimationFrame` loop
 * that moves a field of dots changes them.
 *
 *     pnpm bench:animation                   every scenario
 *     PROFILE=/tmp/p pnpm bench:animation    a .cpuprofile of each measured frame
 *
 * As `renderer.bench.ts`, V8 runs with its optimising tiers off, as Hermes has no JIT, and
 * `bench/release.mjs` turns `ngDevMode` off as a release build does.
 */
import { Component, signal } from '@angular/core';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { mount } from '@ng-native/platform';
import type { FabricUIManager } from '@ng-native/fabric';
import { View } from '../../components/src/view.ts';

const COUNT = 2000;
const dots = Array.from({ length: COUNT }, (_, i) => i);

class Field {
  readonly dots = dots;
  readonly phase = signal(0);
}

@Component({
  selector: 'x-transform',
  imports: [View],
  template: `@for (dot of dots; track dot) {
    <view
      [style.transform]="
        'translate(' +
        ((phase() + dot) % 300) +
        'px, ' +
        ((phase() * 2 + dot) % 200) +
        'px) rotate(' +
        ((phase() * 3 + dot) % 360) +
        'deg)'
      "
    ></view>
  }`,
})
class Transform extends Field {}

@Component({
  selector: 'x-colour',
  imports: [View],
  template: `@for (dot of dots; track dot) {
    <view
      [style.backgroundColor]="'hsl(' + ((phase() * 3 + dot * 37) % 360) + ', 80%, 55%)'"
    ></view>
  }`,
})
class Colour extends Field {}

@Component({
  selector: 'x-opacity',
  imports: [View],
  template: `@for (dot of dots; track dot) {
    <view [style.opacity]="((phase() + dot) % 10) / 10"></view>
  }`,
})
class Opacity extends Field {}

@Component({
  selector: 'x-left',
  imports: [View],
  template: `@for (dot of dots; track dot) {
    <view [style.left.px]="(phase() + dot) % 300"></view>
  }`,
})
class Left extends Field {}

const SCENARIOS: Record<string, new () => Field> = {
  transform: Transform,
  colour: Colour,
  opacity: Opacity,
  left: Left,
};

function nullFabric(): FabricUIManager {
  return {
    createNode: () => ({}),
    cloneNodeWithNewChildren: () => ({}),
    cloneNodeWithNewProps: () => ({}),
    cloneNodeWithNewChildrenAndProps: () => ({}),
    appendChild: (parent) => parent,
    createChildSet: () => [],
    appendChildToSet: () => {},
    completeRoot: () => {},
    registerEventHandler: () => {},
  };
}

const PROFILE = process.env['PROFILE'];
const profiler = PROFILE ? new Session() : null;
profiler?.connect();
profiler?.post('Profiler.enable');
profiler?.post('Profiler.setSamplingInterval', { interval: 50 });

const WARMUP = 5;
const RUNS = Number(process.env['RUNS'] ?? 15);
const only = process.argv.slice(2);

setTimeout(() => {
  for (const name of only.length ? only : Object.keys(SCENARIOS)) {
    const app = mount(1, SCENARIOS[name]!, nullFabric());
    const field = app.componentRef.instance as Field;
    app.applicationRef.tick();
    const times: number[] = [];
    for (let i = 0; i < WARMUP + RUNS; i++) {
      if (i === WARMUP) profiler?.post('Profiler.start');
      const started = performance.now();
      field.phase.update((p) => p + 1);
      app.applicationRef.tick();
      if (i >= WARMUP) times.push(performance.now() - started);
    }
    profiler?.post('Profiler.stop', (error, result) => {
      if (!error) writeFileSync(`${PROFILE}/${name}.cpuprofile`, JSON.stringify(result.profile));
    });
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.log(
      `${name.padEnd(10)} median ${median.toFixed(2).padStart(7)}ms  min ${times[0]!.toFixed(2).padStart(7)}ms`,
    );
  }
});
