/**
 * Snapshots for tests on a device: Vitest's own snapshot state, with its files read and written
 * through the pool, which has the disk, and an inline snapshot's position mapped from the bundle
 * the app ran to the test's source file before Vitest writes it in.
 */
import { symbolicateFrames } from './symbolicate.ts';

type Rpc = (method: string, ...args: unknown[]) => Promise<unknown>;
type Files = (op: 'read' | 'write' | 'remove', path: string, content?: string) => Promise<unknown>;

/** Vitest's `SnapshotEnvironment`, over the pool. */
export class DeviceSnapshotEnvironment {
  private readonly rpc: Rpc;
  private readonly files: Files;

  constructor(rpc: Rpc, files: Files) {
    this.rpc = rpc;
    this.files = files;
  }

  getVersion(): string {
    return '1';
  }

  getHeader(): string {
    return `// Vitest Snapshot v${this.getVersion()}, https://vitest.dev/guide/snapshot.html`;
  }

  async resolvePath(filepath: string): Promise<string> {
    return (await this.rpc('resolveSnapshotPath', filepath)) as string;
  }

  async resolveRawPath(testPath: string, rawPath: string): Promise<string> {
    if (rawPath.startsWith('/')) return rawPath;
    return `${testPath.slice(0, testPath.lastIndexOf('/'))}/${rawPath}`;
  }

  async prepareDirectory(): Promise<void> {}

  async readSnapshotFile(path: string): Promise<string | null> {
    return (await this.files('read', path)) as string | null;
  }

  async saveSnapshotFile(path: string, content: string): Promise<void> {
    await this.files('write', path, content);
  }

  async removeSnapshotFile(path: string): Promise<void> {
    await this.files('remove', path);
  }
}

interface InlineSnapshot {
  file: string;
  line: number;
  column: number;
}

/**
 * Where each inline snapshot a file's run recorded is in the test's source: Vitest takes it from
 * the stack, which on a device points into the test's bundle, at `url` (Vitest keeps the frame's
 * path without the server Metro needs).
 */
export async function placeInlineSnapshots(state: unknown, url: string): Promise<void> {
  const snapshots = (state as { _inlineSnapshots?: InlineSnapshot[] } | undefined)
    ?._inlineSnapshots;
  if (!snapshots?.length) return;
  const frames = await symbolicateFrames(
    snapshots.map(({ line, column }) => ({
      methodName: 'toMatchInlineSnapshot',
      file: url,
      lineNumber: line,
      column,
    })),
  );
  snapshots.forEach((snapshot, index) => {
    const frame = frames[index];
    if (!frame?.file || frame.lineNumber === undefined || frame.column === undefined) return;
    snapshot.file = frame.file;
    snapshot.line = frame.lineNumber;
    snapshot.column = frame.column;
  });
}

interface StackFrame {
  file: string;
  method: string;
}

/**
 * Which frame of a `toMatchInlineSnapshot` call's stack is the test's own: Vitest counts frames from
 * its matcher, which on Hermes do not fall where they do in Node. The test's frame is the first in
 * the bundle the test file was loaded from.
 */
export function inferInlineSnapshotFrames(state: unknown, filepath: string): void {
  const snapshotState = state as
    { _inferInlineSnapshotStack?: (stacks: StackFrame[]) => StackFrame | null } | undefined;
  const infer = snapshotState?._inferInlineSnapshotStack;
  if (!snapshotState || !infer) return;
  const bundle = `${filepath.slice(filepath.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]sx?$/, '')}.bundle`;
  snapshotState._inferInlineSnapshotStack = (stacks) =>
    stacks.find((frame) => frame.file.includes(bundle)) ?? infer.call(snapshotState, stacks);
}
