import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'ngn-host-dir-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** A library's codegen directory, <cache>/libraries/<name>, stamped with this. */
function library(name: string, stamp: string): string {
  const dir = path.join(root, 'libraries', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'stamp'), `${stamp}\n`);
  return dir;
}

function hostDir(...libraries: string[]): string {
  const result = spawnSync('bash', [path.join(scripts, 'host-dir.sh'), '/cache', ...libraries], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe('the host build directory', () => {
  it('is one of its own for each set of compiled-in libraries and their versions', () => {
    const screens = library('screens', 'react-native-screens@4.0.0 /a/node_modules/rns');
    const svg = library('svg', 'react-native-svg@15.0.0 /a/node_modules/rnsvg');

    assert.equal(hostDir(), '/cache/host');
    assert.match(hostDir(screens, svg), /^\/cache\/host\/libs-[0-9a-f]{12}$/);
    assert.equal(hostDir(screens, svg), hostDir(screens, svg));
    // A library denied, or another version of one, builds somewhere else.
    assert.notEqual(hostDir(screens), hostDir(screens, svg));
    const before = hostDir(screens, svg);
    library('screens', 'react-native-screens@4.1.0 /b/node_modules/rns');
    assert.notEqual(hostDir(screens, svg), before);
  });

  it('is what build.sh builds in when the app links nothing', () => {
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    assert.match(build, /host_dir="\$\("\$here\/host-dir\.sh" "\$CACHE" /);
    assert.doesNotMatch(build, /host_dir="\$CACHE\/host"$/m);
  });
});
