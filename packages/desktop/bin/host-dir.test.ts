import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

describe('the first build’s note', () => {
  /** What first-build-note.sh prints for `dir`, with `note` as host.mjs passes it. */
  function noteFor(dir: string, note?: string): string {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
    if (note !== undefined) env['NGN_FIRST_BUILD_NOTE'] = note;
    const result = spawnSync('bash', [path.join(scripts, 'first-build-note.sh'), dir], {
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    return result.stderr;
  }

  it('is printed while the directory this build uses has never been configured, whatever else the cache has', () => {
    const cache = mkdtempSync(path.join(tmpdir(), 'ngn-first-build-'));
    try {
      // Another install's or another app's host, built in the same cache.
      const other = path.join(cache, 'host', 'build-0123456789ab', 'appkit-arm64-RelWithDebInfo');
      mkdirSync(other, { recursive: true });
      writeFileSync(path.join(other, 'build.ninja'), '');
      const own = path.join(cache, 'host', 'build-ba9876543210', 'appkit-arm64-RelWithDebInfo');
      assert.equal(noteFor(own, 'about 4 minutes'), 'about 4 minutes\n');
      // Made, and locked, by a build that never got as far as configuring.
      mkdirSync(own, { recursive: true });
      assert.equal(noteFor(own, 'about 4 minutes'), 'about 4 minutes\n');
      // Configured once: later builds reuse it.
      writeFileSync(path.join(own, 'build.ninja'), '');
      assert.equal(noteFor(own, 'about 4 minutes'), '');
      // A build that explained itself already passes no note.
      assert.equal(noteFor(path.join(cache, 'host', 'build-ffffffffffff'), undefined), '');
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it('is for the directory build.sh builds in, before Hermes or the host compiles', () => {
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    const note = build.indexOf('"$here/first-build-note.sh" "$BUILD"');
    assert.ok(
      note > build.indexOf('BUILD="${build_dir:-$host_dir/'),
      'after the directory is chosen',
    );
    assert.ok(note < build.indexOf('"$here/build-hermes.sh"'), 'before Hermes builds');
    assert.ok(note < build.indexOf('cmake --log-level'), 'before the host configures');
  });
});
