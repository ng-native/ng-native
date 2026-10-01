/**
 * One migration, run the three ways an app is updated, on the same files.
 *
 * `nx migrate` loads it from `@ng-native/nx`'s `migrations.json` and calls it with an Nx `Tree`;
 * `ng update` loads it from `@ng-native/schematics`' `migrations.json` as a schematic; and
 * `ng-native-migrate` runs it over the app's directory. Each of these goes through the real entry,
 * so a migration missing from a `migrations.json`, or wired to the wrong export, fails here.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nxRoot = path.dirname(require.resolve('@ng-native/nx/package.json'));
const schematicsRoot = path.dirname(require.resolve('@ng-native/schematics/package.json'));
const migrateRoot = path.dirname(require.resolve('@ng-native/migrate/package.json'));
const fromNx = createRequire(path.join(nxRoot, 'package.json'));
const fromSchematics = createRequire(path.join(schematicsRoot, 'package.json'));

interface NxTree {
  write(file: string, text: string): void;
  read(file: string, encoding: 'utf-8'): string | null;
}
interface AngularTree {
  create(file: string, text: string): void;
  readText(file: string): string;
  exists(file: string): boolean;
}

/** The files after a run, and what it said was left to do. */
export interface Outcome {
  readonly files: Record<string, string | null>;
  readonly notes: readonly string[];
}

/** Each file's text after the run, or null where it does not exist. */
function after(paths: readonly string[], read: (file: string) => string | null) {
  return Object.fromEntries(paths.map((file) => [file, read(file)]));
}

export async function viaNx(files: Record<string, string>, name: string): Promise<Outcome> {
  const { generators } = JSON.parse(readFileSync(path.join(nxRoot, 'migrations.json'), 'utf8'));
  const [module, exported] = generators[name].implementation.split('#');
  const migration = fromNx(path.join(nxRoot, module))[exported] as (
    tree: NxTree,
  ) => Promise<string[]>;
  const { createTreeWithEmptyWorkspace } = fromNx('@nx/devkit/testing') as {
    createTreeWithEmptyWorkspace: () => NxTree;
  };
  const tree = createTreeWithEmptyWorkspace();
  for (const [file, text] of Object.entries(files)) tree.write(file, text);
  const notes = await migration(tree);
  return { files: after(Object.keys(files), (file) => tree.read(file, 'utf-8')), notes };
}

export async function viaAngular(files: Record<string, string>, name: string): Promise<Outcome> {
  const testing = fromSchematics('@angular-devkit/schematics/testing');
  const { HostTree } = fromSchematics('@angular-devkit/schematics');
  const runner = new testing.SchematicTestRunner(
    '@ng-native/schematics',
    path.join(schematicsRoot, 'migrations.json'),
  );
  const notes: string[] = [];
  runner.logger.subscribe((entry: { level: string; message: string }) => {
    if (entry.level === 'warn') notes.push(entry.message);
  });
  const tree = new testing.UnitTestTree(new HostTree()) as AngularTree;
  for (const [file, text] of Object.entries(files)) tree.create(file, text);
  const result = (await runner.runSchematic(name, {}, tree)) as AngularTree;
  const read = (file: string) => (result.exists(file) ? result.readText(file) : null);
  return { files: after(Object.keys(files), read), notes };
}

/** `ng-native-migrate --from <from>` in a directory holding `files`. */
export function viaCli(
  files: Record<string, string>,
  from: string,
  flags: readonly string[] = [],
): Outcome & { readonly output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-migrate-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    }
    const run = spawnSync(
      process.execPath,
      [path.join(migrateRoot, 'cli.cjs'), '--from', from, ...flags, dir],
      { encoding: 'utf8' },
    );
    if (run.status !== 0) throw new Error(`ng-native-migrate failed:\n${run.stderr}`);
    const read = (file: string) => {
      try {
        return readFileSync(path.join(dir, file), 'utf8');
      } catch {
        return null;
      }
    };
    const notes = run.stdout
      .split('\n')
      .filter((line) => line.startsWith('NOTE '))
      .map((line) => line.slice('NOTE '.length));
    return { files: after(Object.keys(files), read), notes, output: run.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `name` run on `files` through `nx migrate`, `ng update` and `ng-native-migrate`, which has to
 * cross the migration's version: `from` is a version before it.
 */
export async function acrossAdapters(
  files: Record<string, string>,
  name: string,
  from: string,
): Promise<{ nx: Outcome; angular: Outcome; cli: Outcome }> {
  return {
    nx: await viaNx(files, name),
    angular: await viaAngular(files, name),
    cli: (({ files: changed, notes }) => ({ files: changed, notes }))(viaCli(files, from)),
  };
}
