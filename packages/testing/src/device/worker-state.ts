/**
 * Vitest reads its worker state as its module loads: the global `expect` it makes takes its
 * `testPath`, which Hermes reads at once, before the pool has sent a run and `setWorkerState`
 * (`run.ts`) has put the real state in place. Imported before `vitest`, this gives it one to read.
 */
const state = globalThis as { __vitest_worker__?: unknown };
state.__vitest_worker__ ??= { filepath: undefined, config: {} };
