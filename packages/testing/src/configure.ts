/**
 * Testing Library's `configure`, with React Native Testing Library's name for its one option here:
 * how long `waitFor`, every `findBy` query and `waitForElementToBeRemoved` keep trying when a call
 * does not say. A suite on a slow machine sets it once, in a setup file, rather than passing a
 * `timeout` to every call.
 *
 * It holds for every test after it, in every file the runner loads into the same process, until
 * `resetToDefaults()`; a test that changes it puts it back in `finally`.
 */

/** What `configure` sets. */
export interface Config {
  /** How long an async query keeps trying, in milliseconds. Default 1000. */
  readonly asyncUtilTimeout: number;
}

const DEFAULTS: Config = { asyncUtilTimeout: 1000 };

let current: Config = DEFAULTS;

/** Change what the async queries do when a call does not say. */
export function configure(options: Partial<Config>): void {
  current = { ...current, ...options };
}

/** Put back the defaults. */
export function resetToDefaults(): void {
  current = DEFAULTS;
}

/** What the async queries do now. */
export const config = (): Config => current;
