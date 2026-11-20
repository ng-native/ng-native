/**
 * Runs a Node script of this repository in the AlmaLinux 9 image the GTK host is built in
 * (`ngn-el9`, from `packages/desktop/native/docker`), for a tool that measures or draws the Linux
 * host from a Mac: `pnpm bench:linux` and the screens-check skill's `linux` mode. On Linux the tools
 * run directly and this is not used.
 *
 * The repository and each folder the script reads or writes are mounted at their own paths, so
 * every path means the same inside as out, and the script runs as the caller's user. Docker Desktop
 * and Colima share only the home folder with their VM, so every folder must be under it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE = 'ngn-el9';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The `docker run` arguments that run `script` with `args` in the image.
 *
 * @param {string} script
 * @param {readonly string[]} args
 * @param {{ mounts?: readonly string[], image?: string, home?: string, uid?: number, gid?: number, cwd?: string }} [options]
 */
export function imageArguments(script, args, options = {}) {
  const mounts = [...new Set([root, ...(options.mounts ?? [])].map((dir) => path.resolve(dir)))];
  checkShared(mounts, options.home ?? homedir(), options.image ?? IMAGE);
  return [
    'run',
    '--rm',
    '--init',
    ...userArguments(options.uid ?? process.getuid?.(), options.gid ?? process.getgid?.()),
    '-e',
    'HOME=/tmp',
    ...mounts.flatMap((dir) => ['-v', `${dir}:${dir}`]),
    '-w',
    path.resolve(options.cwd ?? process.cwd()),
    options.image ?? IMAGE,
    'node',
    path.resolve(script),
    ...args,
  ];
}

/**
 * Throws for a folder outside `home`, which the container would see as an empty mount.
 *
 * @param {string[]} mounts
 * @param {string} home
 * @param {string} image
 */
function checkShared(mounts, home, image) {
  const outside = mounts.filter((dir) => dir !== home && !dir.startsWith(home + path.sep));
  if (outside.length) {
    throw new Error(
      `The ${image} container sees only folders under ${home}, and these are not: ` +
        `${outside.join(', ')}. Use folders under your home folder.`,
    );
  }
}

/** @param {number | undefined} uid @param {number | undefined} gid */
function userArguments(uid, gid) {
  return uid === undefined || gid === undefined ? [] : ['--user', `${uid}:${gid}`];
}

/**
 * Runs `script` in the image and returns its exit status, with its output passed through. A
 * container that could not start is a failure, never a pass.
 *
 * @param {string} script
 * @param {readonly string[]} args
 * @param {{ mounts?: readonly string[], image?: string }} [options]
 */
export function runInLinuxImage(script, args, options = {}) {
  const result = spawnSync('docker', imageArguments(script, args, options), { stdio: 'inherit' });
  if (result.error) throw new Error(`docker could not be run: ${result.error.message}`);
  return result.status ?? 1;
}

/**
 * Xvfb at 1280 by 800, scale 1, on a display number of its own, where no display is set: sets
 * `DISPLAY` and `GDK_BACKEND` for what this process starts after it, and returns how to stop it.
 */
export async function startXvfb() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return () => {};
  const xvfb = spawn(
    'Xvfb',
    ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    },
  );
  const number = await new Promise((resolve, reject) => {
    xvfb.stdio[3]?.once('data', (chunk) => resolve(String(chunk).trim()));
    xvfb.once('error', (error) => reject(new Error(`Xvfb could not be started: ${error.message}`)));
    xvfb.once('exit', () => reject(new Error('Xvfb exited before it gave a display.')));
  });
  process.env.DISPLAY = `:${number}`;
  process.env.GDK_BACKEND = 'x11';
  return () => xvfb.kill();
}

/**
 * Stop a host this process launched, and resolve once it has exited: `SIGTERM`, then `SIGKILL` if
 * it is still running `graceMs` later. A host that ignores `SIGTERM` would otherwise keep the caller
 * waiting forever, or still be running when the next launch starts. A host that never started
 * resolves at once.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [graceMs]
 */
export function stopHost(child, graceMs = 5_000) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.kill('SIGTERM');
  });
}
