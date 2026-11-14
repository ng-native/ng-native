/**
 * `Processes`: the app's environment on a desktop OS, and the programs it declares, run with
 * `spawn`. Absent on iOS, Android and the web, which give an app neither.
 *
 * The host contract, on the `NgNativeProcesses` module:
 *
 * - `getConstants()` answers `env` (the environment, already filtered to `capabilities.env`),
 *   `envNames` (`capabilities.env` itself), `spawn` (the declared spawn capabilities) and `resolved` (where each declared bare name was
 *   pinned at startup, or null where it is absent).
 * - `spawn(program, args, cwd, env)` runs the program, never through a shell, after checking the
 *   call against the declaration again, and answers a handle; it rejects an undeclared call.
 * - `write(handle, data)`, `closeStdin(handle)` and `kill(handle, signal)`.
 * - `{ type: 'stdout' | 'stderr', handle, data }` and `{ type: 'exit', handle, code, signal }`
 *   arrive on `ngNativeProcesses`.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';
import {
  compileCapability,
  filterEnvironment,
  matchSpawn,
  type CompiledCapability,
  type SpawnCapability,
} from './spawn-rules.ts';

/** How a spawned program ended: its exit code, or the signal that stopped it. */
export interface ProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** What the host reports about a spawned program. */
export type ProcessEvent =
  | { readonly type: 'stdout' | 'stderr'; readonly handle: number; readonly data: string }
  | {
      readonly type: 'exit';
      readonly handle: number;
      readonly code: number | null;
      readonly signal: string | null;
    };

/** What the desktop host's module reports, and what a test fakes. */
export interface NativeProcesses {
  /** The environment variables the app was started with, filtered to those it declares. */
  readonly env: Readonly<Record<string, string>>;
  /** The variables `capabilities.env` declares: all a spawned program may be given. */
  readonly envNames?: readonly string[];
  /** The declared spawn capabilities. None declared, nothing may be spawned. */
  readonly spawnCapabilities?: readonly SpawnCapability[];
  /** Where each declared bare program name was pinned at startup, or null where it is absent. */
  readonly resolved?: Readonly<Record<string, string | null>>;
  spawn?(
    program: string,
    args: readonly string[],
    cwd: string | null,
    env: Readonly<Record<string, string>>,
  ): Promise<number>;
  write?(handle: number, data: string): void;
  closeStdin?(handle: number): void;
  kill?(handle: number, signal: string): void;
  subscribe?(listener: (event: ProcessEvent) => void): () => void;
}

/** A program `spawn` started. */
export interface ChildProcess {
  /** Settles once the program has ended. */
  readonly exit: Promise<ProcessExit>;
  /** Hear what the program writes to standard output. Answers the function that stops it. */
  onStdout(listener: (chunk: string) => void): () => void;
  /** Hear what the program writes to standard error. */
  onStderr(listener: (chunk: string) => void): () => void;
  /** Write to the program's standard input. */
  write(data: string): void;
  /** Close the program's standard input. */
  end(): void;
  /** Stop the program. `SIGTERM` unless it says. */
  kill(signal?: 'SIGTERM' | 'SIGINT' | 'SIGKILL' | 'SIGHUP'): void;
}

/** What `spawn` takes beside the program and its arguments. */
export interface SpawnOptions {
  /** The working directory. The app's own when unset. */
  readonly cwd?: string;
  /**
   * The program's environment. Only the variables the app declares in `capabilities.env` are
   * passed; the rest are left out. Unset, it gets `Processes.env`.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/** A spawn the app did not declare: a misconfiguration, so it throws rather than doing nothing. */
export class UndeclaredCapabilityError extends Error {
  override readonly name = 'UndeclaredCapabilityError';
}

/** The desktop host's TurboModule. */
interface ProcessesTurboModule {
  getConstants?(): {
    env?: Record<string, string>;
    envNames?: string[];
    spawn?: SpawnCapability[];
    resolved?: Record<string, string | null>;
  };
  spawn?(program: string, args: string[], cwd: string | null, env: object): Promise<number>;
  write?(handle: number, data: string): void;
  closeStdin?(handle: number): void;
  kill?(handle: number, signal: string): void;
}

/** React Native's event emitter, which the host's process events arrive on. */
type Emitter = {
  addListener(event: string, listener: (event: unknown) => void): { remove(): void };
};

/** The desktop host's module, or null where there is none: every OS but a desktop one. */
function processesSource(): NativeProcesses | null {
  const native = reactNative() as {
    TurboModuleRegistry?: { get?(name: string): unknown };
    DeviceEventEmitter?: Emitter;
  } | null;
  const module = native?.TurboModuleRegistry?.get?.('NgNativeProcesses') as
    ProcessesTurboModule | null | undefined;
  const constants = module?.getConstants?.();
  if (!module || !constants?.env) return null;
  return {
    ...declared(constants.env, constants),
    ...processMethods(module, native?.DeviceEventEmitter),
  };
}

/** What the host's constants declare, with what an older host leaves out filled in. */
function declared(
  env: Record<string, string>,
  constants: ReturnType<NonNullable<ProcessesTurboModule['getConstants']>>,
) {
  return {
    env,
    envNames: constants.envNames ?? Object.keys(env),
    spawnCapabilities: constants.spawn ?? [],
    resolved: constants.resolved ?? {},
  };
}

/** The module's methods, as the service calls them. */
function processMethods(module: ProcessesTurboModule, emitter: Emitter | undefined) {
  return {
    spawn:
      module.spawn &&
      ((...call: Parameters<NonNullable<NativeProcesses['spawn']>>) =>
        module.spawn!(call[0], [...call[1]], call[2], call[3])),
    write: (handle: number, data: string) => module.write?.(handle, data),
    closeStdin: (handle: number) => module.closeStdin?.(handle),
    kill: (handle: number, signal: string) => module.kill?.(handle, signal),
    subscribe: (listener: (event: ProcessEvent) => void) => {
      const subscription = emitter?.addListener('ngNativeProcesses', (event) =>
        listener(event as ProcessEvent),
      );
      return () => subscription?.remove();
    },
  };
}

/** One spawned program's listeners, until it exits. */
interface Running {
  readonly stdout: Set<(chunk: string) => void>;
  readonly stderr: Set<(chunk: string) => void>;
  exited(exit: ProcessExit): void;
}

@Service()
export class Processes {
  /** Overridden in a test to start the app with an environment, and to fake programs. */
  static readonly SOURCE = new InjectionToken<NativeProcesses | null>(
    'angular-native.processesSource',
    { factory: processesSource },
  );

  private readonly native = inject(Processes.SOURCE);
  private readonly capabilities: readonly CompiledCapability[] = (
    this.native?.spawnCapabilities ?? []
  ).map(compileCapability);
  private readonly running = new Map<number, Running>();
  private readonly unsubscribe = this.native?.subscribe?.((event) => this.heard(event)) ?? null;

  /** Whether the OS gives the app processes: a desktop OS with the desktop host's module. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /** The environment variables, as the app was started with them. Empty where absent. */
  readonly env: Readonly<Record<string, string>> = Object.freeze({ ...this.native?.env });

  /**
   * Run `program` with `args`, never through a shell. The call has to match a capability the app
   * declares in app.json; one that does not throws `UndeclaredCapabilityError`. Resolves to null
   * where processes are absent.
   *
   *   const git = await processes.spawn('git', ['status', '--porcelain'], { cwd: repo });
   *   git?.onStdout((chunk) => output.update((text) => text + chunk));
   *   const { code } = (await git?.exit) ?? { code: null };
   */
  async spawn(
    program: string,
    args: readonly string[] = [],
    options: SpawnOptions = {},
  ): Promise<ChildProcess | null> {
    const native = this.native;
    if (!native?.spawn) return null;
    const match = matchSpawn(this.capabilities, program, args, native.resolved ?? {});
    if (!match) {
      throw new UndeclaredCapabilityError(
        `[angular-native] ${program} ${JSON.stringify(args)} matches no spawn capability. ` +
          'Declare the program and its arguments in capabilities.spawn of the @ng-native/desktop ' +
          'plugin options in app.json, then rebuild with npm run macos.',
      );
    }
    const env = filterEnvironment(
      options.env ?? this.env,
      native.envNames ?? Object.keys(this.env),
    );
    const handle = await native.spawn(match.path, args, options.cwd ?? null, env);
    return this.child(native, handle);
  }

  private child(native: NativeProcesses, handle: number): ChildProcess {
    const stdout = new Set<(chunk: string) => void>();
    const stderr = new Set<(chunk: string) => void>();
    let exited!: (exit: ProcessExit) => void;
    const exit = new Promise<ProcessExit>((resolve) => (exited = resolve));
    this.running.set(handle, { stdout, stderr, exited });
    const listen = (set: Set<(chunk: string) => void>, listener: (chunk: string) => void) => {
      set.add(listener);
      return () => void set.delete(listener);
    };
    return {
      exit,
      onStdout: (listener) => listen(stdout, listener),
      onStderr: (listener) => listen(stderr, listener),
      write: (data) => native.write?.(handle, data),
      end: () => native.closeStdin?.(handle),
      kill: (signal = 'SIGTERM') => native.kill?.(handle, signal),
    };
  }

  private heard(event: ProcessEvent): void {
    const running = this.running.get(event.handle);
    if (!running) return;
    if (event.type === 'exit') {
      this.running.delete(event.handle);
      running.exited({ code: event.code, signal: event.signal });
      return;
    }
    for (const listener of running[event.type]) listener(event.data);
  }

  /** Stop hearing the host, as the app goes. */
  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
