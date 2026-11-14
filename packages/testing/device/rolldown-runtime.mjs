// Run by metro.cjs in a process of its own, since Metro reads its config synchronously and
// Rolldown builds only asynchronously: `node rolldown-runtime.mjs <rolldown> <entry> <out>`.
import { pathToFileURL } from 'node:url';

const [rolldown, entry, out] = process.argv.slice(2);
const { build } = await import(pathToFileURL(rolldown).href);
await build({
  input: entry,
  platform: 'neutral',
  resolve: { mainFields: ['module', 'main'], conditionNames: ['import', 'default'] },
  transform: { target: 'es2020' },
  // As a `require()`, a computed import is one Metro lets through to throw only if it is reached.
  output: { file: out, format: 'cjs', dynamicImportInCjs: false, codeSplitting: false },
  // The entry gates `bench`, which Vitest 5 no longer exports.
  onLog: (level, log, handle) => log.code !== 'IMPORT_IS_UNDEFINED' && handle(level, log),
});
