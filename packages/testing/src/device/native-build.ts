/**
 * The development build a device run installs: built by the pool the first time, then kept by the
 * project's native fingerprint (`@expo/fingerprint`, as EAS and expo-updates compute it), so a run
 * builds again only when native code, config or a native dependency changed.
 *
 * Builds go in `node_modules/.cache/ng-native-device-tests/<os>-<fingerprint>/`, which CI can cache.
 * A project with no `ios` or `android` folder (Continuous Native Generation, as the template is)
 * is prebuilt first, and the folder is marked as generated so its contents never change the
 * fingerprint the build is kept under.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { progress, runCommand } from './command.ts';

export interface NativeBuild {
  /** The `.app` (iOS simulator) or `.apk` (Android). */
  path: string;
  /** Where the build's output went, for a failure that needs it. */
  log: string;
}

/** The project's files `expo prebuild` writes to, kept as they were. */
const CONFIG_FILES = ['app.json', 'app.config.js', 'app.config.ts', 'package.json'];

/** Read `files` now; the function returned writes them back, and removes any that were not there. */
function keep(projectRoot: string, files: readonly string[]): () => void {
  const kept = files.map((file) => {
    const full = path.join(projectRoot, file);
    return { full, content: existsSync(full) ? readFileSync(full) : null };
  });
  return () => {
    for (const { full, content } of kept) {
      if (content === null) rmSync(full, { force: true });
      else writeFileSync(full, content);
    }
  };
}

/** Left in an `ios` or `android` folder the pool generated. */
const GENERATED = '.ng-native-generated';

export async function nativeBuild(
  projectRoot: string,
  os: 'ios' | 'android',
  { abi, signal }: { abi?: string; signal?: AbortSignal } = {},
): Promise<NativeBuild> {
  const key = `${os}-${await fingerprint(projectRoot, os)}${abi ? `-${abi}` : ''}`;
  const dir = path.join(projectRoot, 'node_modules/.cache/ng-native-device-tests', key);
  const log = path.join(dir, 'build.log');
  const built = existsSync(dir) ? readdirSync(dir).find((name) => /\.(app|apk)$/.test(name)) : null;
  if (built) return { path: path.join(dir, built), log };

  mkdirSync(dir, { recursive: true });
  writeFileSync(log, '');
  progress(os, `building the development build, which takes minutes the first time; log: ${log}`);
  const env = { ...process.env, CI: '1' };
  const native = path.join(projectRoot, os);
  try {
    // A folder the pool generated is generated again for a new fingerprint: the app config or a
    // config plugin changed what prebuild writes. One the project keeps is the project's.
    if (existsSync(path.join(native, GENERATED))) rmSync(native, { recursive: true, force: true });
    if (!existsSync(native)) {
      const expo = createRequire(path.join(projectRoot, 'package.json')).resolve('expo/bin/cli');
      // Prebuild rewrites the app's config and scripts (a bundle identifier, `expo run:*`): what a
      // test run must not leave in the project's sources, so they are put back as they were.
      const restore = keep(projectRoot, CONFIG_FILES);
      try {
        await runCommand(process.execPath, [expo, 'prebuild', '-p', os, '--no-install'], {
          cwd: projectRoot,
          env,
          log,
          signal,
        });
      } finally {
        restore();
      }
      writeFileSync(path.join(native, GENERATED), '');
    }
    const output =
      os === 'ios'
        ? await buildIos(native, dir, log, env, signal)
        : await buildAndroid(native, dir, log, abi, signal);
    return { path: output, log };
  } catch (error) {
    throw new Error(
      `The ${os} build for device tests failed; the whole log is ${log}.\n${String(error)}`,
    );
  }
}

async function fingerprint(projectRoot: string, os: string): Promise<string> {
  const expo = createRequire(path.join(projectRoot, 'package.json')).resolve('expo/package.json');
  const { createProjectHashAsync } = createRequire(expo)('@expo/fingerprint') as {
    createProjectHashAsync(root: string, options: object): Promise<string>;
  };
  const generated = existsSync(path.join(projectRoot, os, GENERATED));
  return createProjectHashAsync(projectRoot, {
    platforms: [os],
    ...(generated && { ignorePaths: [`${os}/**`] }),
  });
}

async function buildIos(
  native: string,
  dir: string,
  log: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
): Promise<string> {
  await runCommand('pod', ['install'], { cwd: native, env, log, signal });
  const workspace = readdirSync(native).find((name) => name.endsWith('.xcworkspace'));
  if (!workspace) throw new Error(`No .xcworkspace in ${native}`);
  const scheme = workspace.replace(/\.xcworkspace$/, '');
  const derived = path.join(dir, 'derived');
  await runCommand(
    'xcodebuild',
    [
      '-workspace',
      workspace,
      '-scheme',
      scheme,
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      derived,
      // The simulator's own architecture only, which halves a cold build; no signing to need.
      `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
      'ONLY_ACTIVE_ARCH=YES',
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ],
    { cwd: native, env, log, signal },
  );
  const products = path.join(derived, 'Build/Products/Debug-iphonesimulator');
  const app = readdirSync(products).find((name) => name.endsWith('.app'));
  if (!app) throw new Error(`xcodebuild made no .app in ${products}`);
  renameSync(path.join(products, app), path.join(dir, app));
  // The intermediates are most of the size, and nothing reads them again.
  rmSync(derived, { recursive: true, force: true });
  return path.join(dir, app);
}

async function buildAndroid(
  native: string,
  dir: string,
  log: string,
  abi: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const gradlew = path.join(native, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  await runCommand(
    gradlew,
    [':app:assembleDebug', '--build-cache', ...(abi ? [`-PreactNativeArchitectures=${abi}`] : [])],
    { cwd: native, env: { ...process.env, ANDROID_HOME: androidSdk() }, log, signal },
  );
  const apk = path.join(native, 'app/build/outputs/apk/debug/app-debug.apk');
  if (!existsSync(apk)) throw new Error(`Gradle made no ${apk}`);
  const kept = path.join(dir, 'app-debug.apk');
  renameSync(apk, kept);
  return kept;
}

/** The Android SDK: `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or where Android Studio puts it. */
export function androidSdk(): string {
  const home = process.env['HOME'] ?? '';
  const candidates = [
    process.env['ANDROID_HOME'],
    process.env['ANDROID_SDK_ROOT'],
    path.join(home, process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk'),
  ];
  const sdk = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!sdk) {
    throw new Error('No Android SDK: set ANDROID_HOME to the SDK Android Studio installed.');
  }
  return sdk;
}
