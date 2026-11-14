/**
 * `BackgroundTask`, bound to `expo-background-task`: work the platform runs while the app is in
 * the background.
 *
 * ```ts
 * // main.ts, at the top level, outside Angular
 * TaskManager.defineTask('sync', async () => {
 *   await syncNotes();
 *   return BackgroundTaskResult.Success;
 * });
 *
 * // anywhere in the app
 * private readonly tasks = inject(BackgroundTask);
 * if ((await this.tasks.status()) === BackgroundTaskStatus.Available) {
 *   await this.tasks.register('sync', { minimumInterval: 60 });
 * }
 * ```
 *
 * The task itself is defined with `expo-task-manager` at the top level of `main.ts`: the platform
 * runs it by loading the bundle and evaluating the entry module without bootstrapping Angular, so
 * it can reach no component and no service from `inject()`. This service is the part the app
 * does: registering the task, unregistering it, and asking whether the platform will run
 * background work at all. The platform decides when a registered task runs - WorkManager on
 * Android, BGTaskScheduler on iOS - and the interval is a minimum, not a schedule.
 *
 * Without the module installed, the status is restricted and registering does nothing. The
 * module's expiration listener is not here: it is for the task's own body, which runs outside
 * Angular.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import type {
  BackgroundTaskOptions,
  BackgroundTaskResult as ExpoResult,
  BackgroundTaskStatus as ExpoStatus,
} from 'expo-background-task';
import { expoModule, presence } from './native.ts';

type Expo = typeof import('expo-background-task');

/** The module's functions this service calls. The real module is one; a test provides a fake. */
export type NativeBackgroundTask = Pick<
  Expo,
  | 'getStatusAsync'
  | 'registerTaskAsync'
  | 'unregisterTaskAsync'
  | 'triggerTaskWorkerForTestingAsync'
>;

/**
 * Whether the platform runs background work, as `expo-background-task`'s own enum. Importing the
 * enum from the module loads the module, which a test in Node cannot; these are the same numbers,
 * typed as the enum.
 */
export const BackgroundTaskStatus = {
  Restricted: 1,
  Available: 2,
} as unknown as typeof ExpoStatus;

/** What a task defined with `expo-task-manager` answers with, as the module's own enum. */
export const BackgroundTaskResult = {
  Success: 1,
  Failed: 2,
} as unknown as typeof ExpoResult;

@Service()
export class BackgroundTask {
  /** Overridden in a test to register tasks the platform never runs. */
  static readonly SOURCE = new InjectionToken<NativeBackgroundTask | null>(
    'angular-native.backgroundTaskSource',
    {
      factory: () =>
        expoModule('expo-background-task', () => require('expo-background-task') as Expo),
    },
  );

  private readonly native = inject(BackgroundTask.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /** Whether the platform will run background work: available on a device, restricted on the web. */
  async status(): Promise<ExpoStatus> {
    return (await this.native?.getStatusAsync()) ?? BackgroundTaskStatus.Restricted;
  }

  /**
   * Asks the platform to run the task named, as defined with `expo-task-manager`, every
   * `minimumInterval` minutes at the soonest: twelve hours by default, and never less than fifteen
   * minutes. iOS often ignores a short interval and runs tasks in windows of its own, such as
   * overnight.
   */
  async register(name: string, options?: BackgroundTaskOptions): Promise<void> {
    await this.native?.registerTaskAsync(name, options);
  }

  async unregister(name: string): Promise<void> {
    await this.native?.unregisterTaskAsync(name);
  }

  /**
   * Runs every registered task now, in a debug build, rather than waiting for the platform. False
   * in a release build and without the module.
   */
  async triggerForTesting(): Promise<boolean> {
    return (await this.native?.triggerTaskWorkerForTestingAsync()) ?? false;
  }
}
