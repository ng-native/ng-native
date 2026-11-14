/**
 * `vi.mock` on a device, where Metro loads modules and Vitest's own module loader is not there.
 *
 * Vitest hoists `vi.mock` above a file's imports as it transforms the file. Metro transforms these
 * files, and puts their imports first. So a test file runs twice: the first time only to hear which
 * modules it mocks (`describe`, `it` and the hooks do nothing then), and the second for real, with
 * those modules swapped for their mocks and everything that imports them run again. The real
 * module has run once by then, which Vitest would not have done. After the file, the real modules
 * go back.
 *
 * `vi.hoisted` gives both runs the same value, so a factory and the tests it was written for see
 * the same mocks. A factory may be async and may call `importOriginal`.
 */
import { dependents } from './bundle-modules.ts';
import { fakeModule, metro, modules, reset, type MetroModule } from './loader.ts';

type Factory = (importOriginal: () => Promise<unknown>) => unknown;

interface Registration {
  id: number;
  factory: Factory | undefined;
}

interface ViLike {
  fn: (implementation?: (...args: unknown[]) => unknown) => unknown;
  [key: string]: unknown;
}

let registering = false;
let ids: Record<string, number> = {};
let pending: Registration[] = [];
let hoistedValues: unknown[] = [];
let hoistedIndex = 0;
/** The real record of each module a mock stands in for, to put back. */
const originals = new Map<number, MetroModule>();
/** What each mocked module's real exports are, for `importOriginal` and `vi.importActual`. */
const actuals = new Map<number, unknown>();
const mocked = new Map<number, unknown>();

/** Whether the file is being run only to hear what it mocks. */
export const isRegistering = (): boolean => registering;

/** Put `vi.mock` and its family in place on Vitest's own `vi`. */
export function installMocking(vi: ViLike): void {
  const idOf = (specifier: unknown): number => {
    const id = typeof specifier === 'string' ? ids[specifier] : undefined;
    if (id === undefined) {
      throw new Error(
        `vi.mock: cannot find the module ${String(specifier)} in this test's bundle. ` +
          'A device test mocks a module by a string literal it can resolve, imported by the test ' +
          'or by something it imports.',
      );
    }
    return id;
  };
  vi['mock'] = (specifier: unknown, factory?: Factory) => {
    if (registering) pending.push({ id: idOf(specifier), factory });
  };
  vi['doMock'] = (specifier: unknown, factory?: Factory) => {
    void install({ id: idOf(specifier), factory });
  };
  vi['unmock'] = vi['doUnmock'] = (specifier: unknown) => restore([idOf(specifier)]);
  vi['hoisted'] = (factory: () => unknown) => {
    const index = hoistedIndex++;
    if (registering) hoistedValues[index] = factory();
    return hoistedValues[index];
  };
  vi['importActual'] = async (specifier: unknown) => actualOf(idOf(specifier));
  vi['importMock'] = async (specifier: unknown) =>
    mocked.get(idOf(specifier)) ?? metro()(idOf(specifier));
  automock = (exports: unknown) => automockOf(exports, vi);
}

let automock: (exports: unknown) => unknown = (exports) => exports;

/**
 * Run a test file once to hear what it mocks, then put the mocks in place, ready for the file's run
 * for real. `run` runs the file's module.
 */
export async function prepareMocks(
  specifiers: Record<string, number>,
  entry: number,
  run: () => void,
): Promise<void> {
  ids = specifiers;
  pending = [];
  hoistedValues = [];
  hoistedIndex = 0;
  if (Object.keys(specifiers).length === 0) return;
  registering = true;
  try {
    run();
  } finally {
    registering = false;
    hoistedIndex = 0;
  }
  for (const registration of pending) await install(registration);
  // Whatever imported a mocked module holds its real exports: it runs again, as does the file.
  const stale = dependents(modules(), new Set(pending.map(({ id }) => id)));
  stale.add(entry);
  reset(stale);
}

/** After a file: the real modules back, and what imported the mocks run again to see them. */
export function restoreMocks(): void {
  restore([...originals.keys()]);
  hoistedValues = [];
  hoistedIndex = 0;
}

async function install({ id, factory }: Registration): Promise<void> {
  const registry = modules();
  if (!originals.has(id)) {
    const real = registry.get(id);
    if (!real) return;
    originals.set(id, real);
    actuals.set(id, metro()(id));
  }
  const exports = factory ? await factory(async () => actualOf(id)) : automock(actuals.get(id));
  const value = esModule(exports);
  mocked.set(id, value);
  registry.set(
    id,
    fakeModule(() => value),
  );
}

function restore(restoring: number[]): void {
  const registry = modules();
  const back = restoring.filter((id) => originals.has(id));
  for (const id of back) {
    registry.set(id, originals.get(id)!);
    originals.delete(id);
    actuals.delete(id);
    mocked.delete(id);
  }
  reset(dependents(registry, new Set(back)));
}

async function actualOf(id: number): Promise<unknown> {
  return actuals.get(id) ?? metro()(id);
}

/**
 * A factory's result as a module: its keys are the named exports, and `default` the default one,
 * as Vitest takes it.
 */
function esModule(exports: unknown): unknown {
  if (exports && typeof exports === 'object' && !('__esModule' in exports)) {
    Object.defineProperty(exports, '__esModule', { value: true });
  }
  return exports;
}

/** `vi.mock(path)` with no factory: every function a mock, and objects mocked through. */
function automockOf(exports: unknown, vi: ViLike, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof exports === 'function') return vi.fn();
  if (!exports || typeof exports !== 'object') return exports;
  if (seen.has(exports)) return seen.get(exports);
  const copy: Record<string, unknown> = {};
  seen.set(exports, copy);
  for (const key of Object.keys(exports)) {
    copy[key] = automockOf((exports as Record<string, unknown>)[key], vi, seen);
  }
  return copy;
}
