/**
 * The app's module registry, as the device test host drives it: Metro's own, which its development
 * runtime exposes. Test files and what they import are defined from what the pool sends, run, and
 * run again after an edit, without the app reloading.
 */
import { dependents, scriptOf } from './bundle-modules.ts';
import type { FilePayload } from './pool.ts';

export interface MetroModule {
  isInitialized: boolean;
  hasError?: boolean;
  verboseName?: string;
  dependencyMap?: unknown[] | Record<string, unknown>;
  factory?: (...args: unknown[]) => void;
  publicModule?: { exports: unknown };
  importedAll?: unknown;
  importedDefault?: unknown;
}

type MetroRequire = ((id: number) => unknown) & { getModules(): Map<number, MetroModule> };
type MetroDefine = (
  factory: (...args: unknown[]) => void,
  id: number,
  dependencyMap: number[],
) => void;

export const metro = (): MetroRequire => (globalThis as unknown as { __r: MetroRequire }).__r;
export const modules = (): Map<number, MetroModule> => metro().getModules();

/** The hash of each module a pool has sent this app, reported with every poll. */
export const hashes = new Map<number, string>();

/**
 * Define what the pool sent for a test file, and make what it changed run again: a changed module,
 * every module that imports one (directly or not), and the test file itself.
 */
export function define(payload: FilePayload): void {
  if (payload.error) throw new Error(payload.error);
  const registry = modules();
  const changed = new Set(payload.changed);
  const stale = dependents(registry, changed);
  stale.add(payload.entry);
  for (const id of changed) {
    forgetHotModule(registry.get(id)?.verboseName);
    registry.delete(id);
  }
  reset(stale);
  evaluate(scriptOf(payload.modules, payload.url));
  for (const { id, hash } of payload.modules) hashes.set(id, hash);
}

/**
 * Make modules run again the next time they are required, each into a new exports object: Metro
 * defines a module's exports as properties that cannot be defined again, and the old object stays
 * with whatever already holds it.
 */
export function reset(ids: Iterable<number>): void {
  const registry = modules();
  const empty = blankModule();
  for (const id of ids) {
    const mod = registry.get(id);
    if (!mod) continue;
    forgetHotModule(mod.verboseName);
    mod.isInitialized = false;
    mod.hasError = false;
    mod.publicModule = { exports: {} };
    mod.importedAll = empty.importedAll;
    mod.importedDefault = empty.importedDefault;
  }
}

/** Run a module, from the top, as if it had not run before. */
export function rerun(id: number): unknown {
  reset([id]);
  return metro()(id);
}

function evaluate(script: string): void {
  // Indirect, so it runs as a script of its own: its `sourceURL` names it in stacks.
  (0, eval)(script);
}

/**
 * Run again with the same source, a module that declares components reads to the Metro transform's
 * hot reload as a dependency's update it cannot apply, and it reloads the app. A module run again
 * here is not an update: forgetting it makes the run its first.
 */
function forgetHotModule(name: string | undefined): void {
  if (!name) return;
  const registry = (globalThis as { __angularNativeHmr?: Map<string, unknown> }).__angularNativeHmr;
  for (const key of registry?.keys() ?? []) {
    if (name.endsWith(key.replace(/^(\.\.\/)+/, ''))) registry!.delete(key);
  }
}

/** The module record Metro makes for a module not yet imported, for its import caches' markers. */
let blank: MetroModule | undefined;

/**
 * A record as Metro defines one: its import caches hold a marker of Metro's own for "not yet",
 * which only a definition makes, so a probe module is defined to read them from.
 */
function blankModule(): MetroModule {
  if (!blank) {
    const probe = -0x5eed;
    (globalThis as unknown as { __d: MetroDefine }).__d(() => {}, probe, []);
    blank = modules().get(probe)!;
    modules().delete(probe);
  }
  return blank;
}

/**
 * A fresh record for a module whose exports are `exports`: what `vi.mock` puts in place of the
 * module. Metro marks a record's import caches as empty with a value of its own, which a fresh
 * definition carries.
 */
export function fakeModule(exports: () => unknown): MetroModule {
  return {
    ...blankModule(),
    isInitialized: false,
    hasError: false,
    publicModule: { exports: {} },
    factory: (...args: unknown[]) => {
      const module = args[4] as { exports: unknown };
      module.exports = exports();
    },
  };
}

/** The modules the host itself runs on, which isolation between files leaves alone. */
let kept: Set<number> | undefined;

/**
 * Isolation between test files: every module from the app's own source that a test file could
 * have reached runs again for the next one, with its module-level state afresh. What the test host
 * runs on (Angular, the engine, React Native, Vitest) and other packages are kept, as is anything
 * a native module was registered from.
 */
export function isolate(projectModule: (name: string) => boolean): void {
  const registry = modules();
  kept ??= closureOf(registry, hostModule(registry));
  const fresh: number[] = [];
  for (const [id, mod] of registry) {
    if (!mod.isInitialized || kept.has(id) || !mod.verboseName) continue;
    if (projectModule(mod.verboseName)) fresh.push(id);
  }
  reset(fresh);
}

function hostModule(registry: Map<number, MetroModule>): number | undefined {
  for (const [id, mod] of registry) {
    if (mod.verboseName && /testing\/src\/device\/host\.ts$/.test(mod.verboseName)) return id;
  }
  return undefined;
}

function closureOf(registry: Map<number, MetroModule>, root: number | undefined): Set<number> {
  const seen = new Set<number>();
  const queue = root === undefined ? [] : [root];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const map = registry.get(id)?.dependencyMap ?? [];
    for (const dependency of Array.isArray(map) ? map : Object.values(map)) {
      if (typeof dependency === 'number') queue.push(dependency);
    }
  }
  return seen;
}
