import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { desktopLinks } from './autolink.mjs';

const linkedModules = fileURLToPath(
  new URL('../native/cmake/linked-modules.cmake', import.meta.url),
);
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-linked-modules-')));
after(() => rmSync(root, { recursive: true, force: true }));

let count = 0;

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Configures cmake/linked-modules.cmake alone (no compiler, no build) for `backend`, over `link`
 * as the app's link.json, with an empty CMake fragment for each library and app module that
 * names a target. Returns the process and what the file left in NGN_LINKED.
 */
function configure(backend: string, link: object) {
  const dir = path.join(root, `case-${count++}`);
  const linkFile = path.join(dir, 'link.json');
  write(linkFile, JSON.stringify(link));
  write(
    path.join(dir, 'src/CMakeLists.txt'),
    [
      'cmake_minimum_required(VERSION 3.25)',
      'project(fixture C)',
      'add_library(react_native INTERFACE)',
      'set(NGN_BACKEND ' + backend + ')',
      `include(${linkedModules})`,
      'message(STATUS "NGN_LINKED=[${NGN_LINKED}]")',
      '',
    ].join('\n'),
  );
  const run = spawnSync(
    'cmake',
    ['-S', path.join(dir, 'src'), '-B', path.join(dir, 'build'), `-DNGN_DESKTOP_LINK=${linkFile}`],
    { encoding: 'utf8' },
  );
  return { run, linked: /NGN_LINKED=\[(.*)\]/.exec(run.stdout)?.[1] };
}

/** A library fragment declaring `target`, in a folder of its own. */
function library(name: string, target: string) {
  const dir = path.join(root, `lib-${count++}-${name}`);
  write(path.join(dir, 'CMakeLists.txt'), `add_library(${target} STATIC ${target}.c)\n`);
  write(path.join(dir, `${target}.c`), `int ${target}_symbol;\n`);
  return { name, dir, cmakeTarget: target, cmakeDir: dir };
}

describe('cmake/linked-modules.cmake', () => {
  it('links a Linux library into the gtk backend from a link.json for Linux', () => {
    const lib = library('rn-haptics', 'haptics_linux');
    const { run, linked } = configure('gtk', {
      version: 1,
      os: 'linux',
      libraries: [lib],
      appModules: [],
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(linked, '$<LINK_LIBRARY:WHOLE_ARCHIVE,haptics_linux>');
  });

  it("takes an app module's CMake target from modules/<name>/linux, as autolinking lists it", () => {
    const app = path.join(root, `app-${count++}`);
    write(path.join(app, 'package.json'), '{}');
    write(
      path.join(app, 'modules/clock/linux/CMakeLists.txt'),
      'add_library(clock_linux STATIC clock.c)\n',
    );
    write(path.join(app, 'modules/clock/linux/clock.c'), 'int clock_symbol;\n');
    write(
      path.join(app, 'modules/clock/expo-module.config.json'),
      JSON.stringify({ linux: { cmakeTarget: 'clock_linux' } }),
    );
    const { os, libraries, appModules } = desktopLinks(app, { os: 'linux' });
    const { run, linked } = configure('gtk', { version: 1, os, libraries, appModules });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(linked, '$<LINK_LIBRARY:WHOLE_ARCHIVE,clock_linux>');
  });

  it("refuses a link.json for macOS under the gtk backend, whose modules' sources are macOS's", () => {
    const { run } = configure('gtk', {
      version: 1,
      os: 'macos',
      libraries: [library('rn-haptics', 'haptics_macos')],
      appModules: [],
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /links native code for macos, and the gtk backend is built for linux/);
  });

  it('refuses a link.json for Linux under the appkit backend', () => {
    const { run } = configure('appkit', { version: 1, os: 'linux', libraries: [], appModules: [] });
    assert.notEqual(run.status, 0);
    assert.match(
      run.stderr,
      /links native code for linux, and the appkit backend is built for macos/,
    );
  });

  it('still reads a link.json written before it named an OS as macOS', () => {
    const lib = library('rn-haptics', 'haptics_macos');
    const { run, linked } = configure('appkit', { version: 1, libraries: [lib], appModules: [] });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(linked, '$<LINK_LIBRARY:WHOLE_ARCHIVE,haptics_macos>');
  });
});
