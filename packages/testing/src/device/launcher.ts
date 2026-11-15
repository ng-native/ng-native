/**
 * How a pool starts the app it runs tests in, where it can: a Mac app is a process the pool opens,
 * unlike a simulator, which a person has open.
 *
 * ## What the desktop host must do (the contract `macosLauncher()` relies on)
 *
 * The launcher runs the desktop CLI (`ng-native-desktop run --port <metro port>`) with these
 * environment variables, which the CLI passes to the host, and which the host reads before it
 * loads the bundle:
 *
 * - `NGN_TESTS=1`: a test launch. The host opens its windows on screen but does not activate the
 *   app or take focus from what the person is using (`NSApplicationActivationPolicyAccessory`
 *   until a test asks for the key window, and the Dock icon stays hidden). A test that needs the
 *   key window asks for it through `AppWindows`, and the host then activates the app.
 * - `NGN_STATE_DIR=<dir>`: a directory that is empty at launch. The host puts its Application
 *   Support, Caches and temporary directories under it (`<dir>/Application Support`,
 *   `<dir>/Caches`, `<dir>/tmp`) and opens a `UserDefaults` suite named by `NGN_RUN_ID`, so the
 *   app starts with no state of an earlier run and leaves none behind. The pool removes `<dir>`
 *   when the run ends.
 * - `NGN_RUN_ID=<uuid>`: unique to this launch. The host namespaces its Keychain items by it
 *   (`kSecAttrService` is prefixed `ngn-test-<id>.`) and deletes every item with that prefix on a
 *   clean exit, and at the start of the next launch for one that crashed.
 * - `NGN_TESTS_FAKE_SYSTEM_UI=1`: calls that show system UI (open and save panels, alerts that wait
 *   for a person, notification and other permission prompts, Touch ID) answer as a person
 *   cancelling or denying would, at once, so a run never waits on one. A test that wants the real
 *   thing turns it off for its own calls through the `SOURCE` token of the service it exercises.
 *
 * The app's JavaScript reaches the pool on its own: `startDeviceTests()` polls
 * `http://127.0.0.1:51730` (see `host.ts`), with `platform` `macos`. The host's dev build loads the
 * test host only where Metro was started with `EXPO_PUBLIC_DEVICE_TESTS`, as on a phone.
 *
 * The process exits with the host's own status. A crash leaves a report in
 * `~/Library/Logs/DiagnosticReports` named for the executable (`ngn-macos-*.ips`), which the
 * pool names in the failure.
 */

/** What a launch is given. */
export interface LaunchRequest {
  /** The pool's port, which the app's test host polls. */
  port: number;
  /** Unique to this launch: the host namespaces what it shares with the system by it. */
  runId: string;
  /** A new empty directory for this launch's state. */
  stateDir: string;
}

/** An app a launcher started. */
export interface LaunchedApp {
  /** Settles when the app's process ends, with how, as text. */
  readonly exited: Promise<string>;
  /** End the app if it is running, and remove the state it was given. */
  stop(): Promise<void>;
}

export interface AppLauncher {
  start(request: LaunchRequest): LaunchedApp | Promise<LaunchedApp>;
  /**
   * What the pool adds to a failure when the app is lost, such as where its crash report is. `since`
   * is when the app was started, in milliseconds since the epoch.
   */
  crashReport?(since: number): string | undefined | Promise<string | undefined>;
}
