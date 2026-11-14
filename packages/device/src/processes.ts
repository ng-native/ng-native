/**
 * `Processes`: the app's environment on a desktop OS, and where `spawn` will run the programs an
 * app declares. Absent on iOS, Android and the web, which give an app neither.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

/** What the desktop host's module reports. */
export interface NativeProcesses {
  /** The environment variables the app was started with, filtered to those it declares. */
  readonly env: Readonly<Record<string, string>>;
}

/** The desktop host's TurboModule, which answers its environment as a constant. */
interface ProcessesTurboModule {
  getConstants?(): { env?: Record<string, string> };
}

/** The desktop host's module, or null where there is none: every OS but a desktop one. */
function processesSource(): NativeProcesses | null {
  const native = reactNative() as {
    TurboModuleRegistry?: { get?(name: string): unknown };
  } | null;
  const module = native?.TurboModuleRegistry?.get?.('NgNativeProcesses') as
    ProcessesTurboModule | null | undefined;
  const env = module?.getConstants?.().env;
  return env ? { env } : null;
}

@Service()
export class Processes {
  /** Overridden in a test to start the app with an environment. */
  static readonly SOURCE = new InjectionToken<NativeProcesses | null>(
    'angular-native.processesSource',
    { factory: processesSource },
  );

  private readonly native = inject(Processes.SOURCE);

  /** Whether the OS gives the app processes: a desktop OS with the desktop host's module. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /** The environment variables, as the app was started with them. Empty where absent. */
  readonly env: Readonly<Record<string, string>> = Object.freeze({ ...this.native?.env });
}
