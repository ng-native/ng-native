#!/usr/bin/env node
/**
 * `npx @ng-native/migrate@latest`: updates an app that has neither `nx migrate` nor `ng update`,
 * such as one made from `@ng-native/template`.
 *
 *     ng-native-migrate [--from <version>] [--dry-run] [directory]
 *
 * Run it before installing, as `nx migrate` is. It updates the app from the `@ng-native/*` version
 * its `package.json` lists (or `--from`) to this package's own version, by running every migration
 * newer than that version, oldest first. One of them moves the versions in `package.json`,
 * so the install comes after. It prints each file it changed and what is left to do by hand;
 * `--dry-run` prints the same and writes nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const semver = require('semver');
const { migrations } = require('./migrations.cjs');
const { version } = require('./package.json');

/** The app's directory as a host whose writes are kept until `save()`. */
function directoryHost(root) {
  /** @type {Map<string, string>} */
  const written = new Map();
  const read = (file) => {
    if (written.has(file)) return written.get(file) ?? null;
    const full = path.join(root, file);
    return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : null;
  };
  return {
    read,
    write: (file, text) => written.set(file, text),
    list(dir) {
      const files = [];
      const dirs = [];
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (entry.isFile()) files.push(entry.name);
        else if (entry.isDirectory()) dirs.push(entry.name);
      }
      return { files, dirs };
    },
    /** The files whose text changed, as they are now. */
    changes() {
      const original = (file) => {
        const full = path.join(root, file);
        return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
      };
      return [...written].filter(([file, text]) => original(file) !== text);
    },
    save() {
      for (const [file, text] of this.changes()) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      }
    },
  };
}

/** The lowest `@ng-native/*` version the app's `package.json` lists, or null for none. */
function listedVersion(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const versions = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter(([name]) => name.startsWith('@ng-native/'))
    .map(([, range]) => semver.validRange(range) && semver.minVersion(range))
    .filter((found) => !!found);
  return versions.length ? semver.sort(versions)[0].version : null;
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { from: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const root = path.resolve(positionals[0] ?? '.');
  const from = values.from ?? listedVersion(root);
  if (!from || !semver.valid(from)) {
    console.error(
      `No @ng-native version found in ${path.join(root, 'package.json')}. ` +
        'Say which version the app is on with --from, as in --from 0.2.0.',
    );
    return 1;
  }
  // No upper bound: this package holds only the migrations up to its own release.
  const due = migrations
    .filter((migration) => semver.gt(migration.version, from))
    .sort((a, b) => semver.compare(a.version, b.version));
  if (!due.length) {
    console.log(`Nothing to migrate from ${from} to ${version}.`);
    return 0;
  }
  console.log(`Migrating from ${from} to ${version}.`);
  const host = directoryHost(root);
  const notes = [];
  for (const migration of due) {
    console.log(`- ${migration.name}: ${migration.description}`);
    notes.push(...migration.run(host));
  }
  const changes = host.changes();
  for (const [file] of changes) console.log(`UPDATE ${file}`);
  for (const note of notes) console.log(`NOTE ${note}`);
  if (values['dry-run']) console.log('Dry run: nothing was written.');
  else host.save();
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
