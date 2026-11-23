/**
 * `<ng-icon>` on a page with many of them, in Node, against a Fabric that does nothing.
 *
 *     pnpm bench:icons                  every scenario
 *     pnpm bench:icons colour size      some of them
 *     ICONS=2000 pnpm bench:icons       how many icons
 *     PROFILE=/tmp/p ...                a .cpuprofile of the measured step, per run
 */
import { Component, signal } from '@angular/core';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { provideIcons } from '@ng-icons/core';
import * as hero from '@ng-icons/heroicons/outline';
import * as lucide from '@ng-icons/lucide';
import { mount } from '@ng-native/platform';
import type { FabricUIManager } from '@ng-native/fabric';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { View } from '../../components/src/view.ts';

/** Forty icons, from two sets, repeated: a feed or a settings list reuses a handful. */
const icons = {
  ...Object.fromEntries(Object.entries(hero).slice(0, 20)),
  ...Object.fromEntries(Object.entries(lucide).slice(0, 20)),
} as Record<string, string>;
const NAMES = Object.keys(icons);
const COUNT = Number(process.env['ICONS'] ?? 1000);

@Component({
  selector: 'x-bench',
  imports: [NgIcon, View],
  providers: [provideIcons(icons)],
  template: `
    <view>
      @for (row of rows(); track row.id) {
        <ng-icon [name]="row.name" [size]="size()" [color]="colour()" />
      }
    </view>
  `,
})
class Bench {
  readonly rows = signal<{ id: number; name: string }[]>([]);
  readonly size = signal(24);
  readonly colour = signal('#ff9f0a');
}

function nullFabric() {
  const calls: Record<string, number> = {};
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
  const fabric: FabricUIManager = {
    createNode: () => (count('create'), {}),
    cloneNodeWithNewChildren: () => (count('clone'), {}),
    cloneNodeWithNewProps: () => (count('clone'), {}),
    cloneNodeWithNewChildrenAndProps: () => (count('clone'), {}),
    appendChild: (parent) => parent,
    createChildSet: () => [],
    appendChildToSet: () => {},
    completeRoot: () => void count('commit'),
    registerEventHandler: () => {},
  };
  return { fabric, calls };
}

let nextId = 0;
const build = () =>
  Array.from({ length: COUNT }, (_, i) => ({ id: nextId++, name: NAMES[i % NAMES.length]! }));

type Step = (bench: Bench) => void;
const SCENARIOS: Record<string, { setup?: Step; run: Step }> = {
  create: { run: (b) => b.rows.set(build()) },
  colour: {
    setup: (b) => b.rows.set(build()),
    run: (b) => b.colour.update((c) => (c === '#ff9f0a' ? '#0a84ff' : '#ff9f0a')),
  },
  size: {
    setup: (b) => b.rows.set(build()),
    run: (b) => b.size.update((s) => (s === 24 ? 28 : 24)),
  },
  clear: { setup: (b) => b.rows.set(build()), run: (b) => b.rows.set([]) },
};

const PROFILE = process.env['PROFILE'];
let profiles = 0;
const profiler = PROFILE ? new Session() : null;
profiler?.connect();
profiler?.post('Profiler.enable');
profiler?.post('Profiler.setSamplingInterval', { interval: 50 });

function once(app: ReturnType<typeof mount>, calls: Record<string, number>, name: string) {
  const bench = app.componentRef.instance as Bench;
  bench.rows.set([]);
  app.applicationRef.tick();
  const scenario = SCENARIOS[name]!;
  if (scenario.setup) {
    scenario.setup(bench);
    app.applicationRef.tick();
  }
  for (const key of Object.keys(calls)) delete calls[key];
  profiler?.post('Profiler.start');
  const started = performance.now();
  scenario.run(bench);
  app.applicationRef.tick();
  const ms = performance.now() - started;
  profiler?.post('Profiler.stop', (error, result) => {
    if (!error)
      writeFileSync(`${PROFILE}/${name}-${profiles++}.cpuprofile`, JSON.stringify(result.profile));
  });
  return { ms, calls: { ...calls } };
}

const RUNS = Number(process.env['RUNS'] ?? 7);
const only = process.argv.slice(2);
setTimeout(() => {
  for (const name of only.length ? only : Object.keys(SCENARIOS)) {
    const { fabric, calls } = nullFabric();
    const app = mount(1, Bench, fabric);
    for (let i = 0; i < 2; i++) once(app, calls, name);
    const times: number[] = [];
    let last = {};
    for (let i = 0; i < RUNS; i++) {
      const run = once(app, calls, name);
      times.push(run.ms);
      last = run.calls;
    }
    times.sort((a, b) => a - b);
    console.log(
      `${name.padEnd(7)} median ${times[Math.floor(times.length / 2)]!.toFixed(1).padStart(8)}ms  min ${times[0]!.toFixed(1).padStart(8)}ms  ${JSON.stringify(last)}`,
    );
  }
});
