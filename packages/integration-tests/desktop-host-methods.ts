/**
 * What the desktop host's TurboModules register, read from its C++ sources, so a fake host in a
 * test can be checked against the real one. A fake host uses the adapter's own method names, so a
 * method renamed in the C++, or misspelt in an adapter and its fake together, would otherwise keep
 * every test green while the call does nothing on a Mac.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = fileURLToPath(new URL('../desktop/native/core/src', import.meta.url));

/** Every `.cpp` file under the host's core. */
function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.cpp') ? [path] : [];
  });
}

/**
 * The names each module registers. A module's names are the ones registered between its
 * `NativeModule("Name")` and the next module's, with the keys of its `constants`. `answer(name)` registers `name` and the name with
 * `Async` (or nothing) swapped for `Sync`; `both(name)` registers `nameAsync` and `nameSync`; a
 * `for` over a list of names registers each of them.
 */
function readRegistrations(): Map<string, Set<string>> {
  const modules = new Map<string, Set<string>>();
  for (const file of sources(CORE)) {
    const source = readFileSync(file, 'utf8');
    const starts = [...source.matchAll(/NativeModule\("([A-Za-z]+)"\)/g)];
    starts.forEach((start, index) => {
      const body = source.slice(start.index, starts[index + 1]?.index ?? source.length);
      const names = modules.get(start[1]!) ?? new Set<string>();
      modules.set(start[1]!, names);
      for (const [, kind, name] of body.matchAll(
        /\b(promise|sync|answer|both|property|constant)\(\s*"([A-Za-z]+)"/g,
      )) {
        if (kind === 'both') {
          names.add(`${name}Async`).add(`${name}Sync`);
          continue;
        }
        names.add(name!);
        if (kind === 'answer') names.add(`${name!.replace(/Async$/, '')}Sync`);
      }
      for (const [, list] of body.matchAll(/for \(const char \*\w+ : \{([^}]*)\}\)/g)) {
        for (const [, name] of list!.matchAll(/"([A-Za-z]+)"/g)) names.add(name!);
      }
      for (const [, list] of body.matchAll(/constants\(\[[^\]]*\]\s*\{([\s\S]*?)\}\);/g)) {
        for (const [, name] of list!.matchAll(/(?:object\(|\)\()"([A-Za-z]+)"/g)) names.add(name!);
      }
    });
  }
  return modules;
}

let registrations: Map<string, Set<string>> | undefined;

/** The names the desktop host's module `name` registers, or undefined where it has no such module. */
export function hostMethods(name: string): ReadonlySet<string> | undefined {
  registrations ??= readRegistrations();
  return registrations.get(name);
}

/**
 * `fake`, once each of its members is checked against what the desktop host's module `name`
 * registers: a fake for a module the host does not have, or with a member the host does not
 * register, fails the test that builds it.
 */
export function asHost<T extends object>(name: string, fake: T): T {
  const registered = hostMethods(name);
  assert.ok(registered, `The desktop host registers no ${name}.`);
  const unknown = Object.keys(fake).filter((member) => !registered.has(member));
  assert.deepEqual(
    unknown,
    [],
    `${name} in the desktop host registers none of ${unknown.join(', ')}.`,
  );
  return fake;
}
