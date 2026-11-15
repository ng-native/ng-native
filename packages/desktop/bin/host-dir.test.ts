import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));

/** The directory host-dir.sh names for this native source folder and these library folders. */
function hostDir(source: string, ...libraries: string[]): string {
  const result = spawnSync(
    'bash',
    [path.join(scripts, 'host-dir.sh'), '/cache', source, ...libraries],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe('the host build directory', () => {
  // codegen-library.sh names each library's folder by its version, so the folders are the key.
  const screens = '/cache/libraries/rnscreens-0123456789ab';
  const screensNext = '/cache/libraries/rnscreens-ba9876543210';
  const svg = '/cache/libraries/rnsvg-0123456789ab';

  it('is one of its own for each set of compiled-in libraries and their versions', () => {
    assert.match(hostDir('/a/native', screens, svg), /^\/cache\/host\/build-[0-9a-f]{12}$/);
    assert.equal(hostDir('/a/native', screens, svg), hostDir('/a/native', screens, svg));
    // A library denied, or another version of one, builds somewhere else.
    assert.notEqual(hostDir('/a/native', screens), hostDir('/a/native', screens, svg));
    assert.notEqual(hostDir('/a/native', screensNext, svg), hostDir('/a/native', screens, svg));
  });

  it('is one of its own for each install of the native sources, libraries or none', () => {
    assert.match(hostDir('/a/native'), /^\/cache\/host\/build-[0-9a-f]{12}$/);
    assert.notEqual(hostDir('/a/native'), hostDir('/b/native'));
    assert.notEqual(hostDir('/a/native', screens), hostDir('/b/native', screens));
  });

  it('is what build.sh builds in when the app links nothing', () => {
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    assert.match(build, /host_dir="\$\("\$here\/host-dir\.sh" "\$CACHE" "\$native_dir" /);
    assert.match(build, /^native_dir="\$\(cd "\$here\/\.\." && pwd -P\)"$/m);
    assert.match(build, /-S "\$native_dir"/);
  });
});
