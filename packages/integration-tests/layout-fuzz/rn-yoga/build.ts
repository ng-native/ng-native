/**
 * Build `rn-yoga.node`: the addon in `rn-yoga.cc` with the Yoga sources vendored in the
 * react-native package this workspace resolves, so the fuzzer lays out with the Yoga a device
 * runs rather than npm's `yoga-layout`, which is older. Needs a C++20 compiler and the Node-API
 * headers of the Node running it. Rebuilt when react-native's version or this source changes.
 *
 *   node layout-fuzz/rn-yoga/build.ts
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const reactNative = dirname(require.resolve('react-native/package.json'));
const version = JSON.parse(readFileSync(join(reactNative, 'package.json'), 'utf8')).version;
const yoga = join(reactNative, 'ReactCommon', 'yoga');
const out = join(here, 'build');
const addon = join(out, 'rn-yoga.node');
const stamp = join(out, 'react-native-version');

export function build(): string {
  // Built again when react-native's version or the addon's own source changes.
  const source = readFileSync(join(here, 'rn-yoga.cc'), 'utf8');
  const wanted = `${version} ${createHash('sha256').update(source).digest('hex')}`;
  if (existsSync(addon) && existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted)
    return addon;
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.cpp')) sources.push(path);
    }
  };
  walk(join(yoga, 'yoga'));
  const headers = join(dirname(dirname(process.execPath)), 'include', 'node');
  if (!existsSync(join(headers, 'node_api.h')))
    throw new Error(`no Node-API headers in ${headers}`);
  mkdirSync(out, { recursive: true });
  execFileSync(
    'clang++',
    [
      ...['-std=c++20', '-O2', '-shared', '-fPIC', '-undefined', 'dynamic_lookup'],
      '-DNODE_GYP_MODULE_NAME=rn_yoga',
      `-I${yoga}`,
      `-I${headers}`,
      join(here, 'rn-yoga.cc'),
      ...sources,
      '-o',
      addon,
    ],
    { stdio: 'inherit' },
  );
  writeFileSync(stamp, wanted);
  return addon;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`built ${build()} from react-native ${version}'s Yoga`);
}
