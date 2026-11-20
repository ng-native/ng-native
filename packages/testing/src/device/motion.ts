/**
 * `setAnimations(false)`: motion off in a device test, so what it reads or captures is where each
 * change ends. The engine's CSS transitions and `@keyframes` animations take no time (see
 * `EngineOptions.motion`), and native view animations stop too: UIKit's on iOS, every Animator on
 * Android where the OS lets the app set its own duration scale.
 */
import { harness } from './harness.ts';
import { nativeModule } from './screenshot.ts';

/** What `deviceTests({ animations })` asked for, which each test starts from. */
let configured = true;

/**
 * Animations on or off, from the next change on. Each test starts as the project's
 * `deviceTests({ animations })` says, `true` unless it says otherwise. Resolves with whether native
 * view animations went along: on Android the OS can refuse, and then only the engine's stop.
 */
export async function setAnimations(enabled: boolean): Promise<boolean> {
  harness().app.engine.setMotion(enabled ? 'on' : 'off');
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  // Without the native module (Expo Go, an older build) the engine's own still stop.
  if (!modules?.['NgNativeTesting']) return false;
  return (await nativeModule().setAnimationsEnabled?.(enabled)) ?? false;
}

/** Set by the device runner from the project's config, before each run. */
export function configureAnimations(enabled: boolean): void {
  configured = enabled;
}

/** Back to the project's setting, after each test. */
export async function resetAnimations(): Promise<void> {
  await setAnimations(configured);
}
