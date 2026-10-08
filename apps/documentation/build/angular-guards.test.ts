/**
 * `angularGuards()` against the exact output `@oxc-angular/vite` produces for the bug it
 * guards - not hand-written strings standing in for them, so a fixed compiler stops failing this
 * test the moment it stops needing the guard.
 */
import { transformAngularFileSync } from '@oxc-angular/vite/api';
import { describe, expect, it } from 'vitest';
import { angularGuards } from './angular-guards.ts';

/** Runs the plugin's `transform` hook the way Vite would call it, `this` aside - the guard does
 *  not read it. */
function transform(code: string, id: string): unknown {
  const hook = angularGuards().transform as (this: void, code: string, id: string) => unknown;
  return hook(code, id);
}

describe("angularGuards, the docs site's own build-failure checks", () => {
  it('fails the build on a template arrow function that reads its own parameter', () => {
    const src = `
      import { Component, signal } from '@angular/core';
      @Component({
        selector: 'x-toggle',
        template: '<pressable (press)="open.update((o) => !o)"></pressable>',
      })
      export class Toggle { open = signal(false); }
    `;
    const { code } = transformAngularFileSync(src, '/x/toggle.ts', {});
    // Confirms the fixture still trips the known bug, so this test fails loudly rather than
    // silently passing once the compiler is fixed and `ctx.` stops appearing.
    expect(code).toMatch(/ctx\.o\b/);

    expect(() => transform(code, '/x/toggle.ts')).toThrowError(
      /toggle\.ts: .*arrow function.*"o".*method/s,
    );
  });

  it('leaves a component alone whose arrow reads only the component, not a parameter', () => {
    const src = `
      import { Component, signal } from '@angular/core';
      @Component({
        selector: 'x-toggle',
        template: '<pressable (press)="open.update(() => !open())"></pressable>',
      })
      export class Toggle { open = signal(false); }
    `;
    const { code } = transformAngularFileSync(src, '/x/toggle-ok.ts', {});
    expect(() => transform(code, '/x/toggle-ok.ts')).not.toThrow();
  });

  it('ignores a module transform sees that compiled no component at all', () => {
    expect(() => transform('export const answer = 42;', '/x/plain.ts')).not.toThrow();
  });
});
