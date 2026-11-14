/**
 * Whether the app is in front of the user.
 *
 * `inactive` is iOS only and means the transitional state: the app switcher is open, a call is
 * coming in, the notification shade is down. Anything that should stop when the user is not
 * looking - a poll, a video, a timer - wants `active`, not the absence of `background`.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { reactNative } from './react-native.ts';

export type AppStatus = 'active' | 'background' | 'inactive';

export interface AppStateSource {
  current(): AppStatus;
  subscribe(listener: (state: AppStatus) => void): () => void;
}

const known = (state: string | null | undefined): AppStatus =>
  state === 'background' || state === 'inactive' ? state : 'active';

export function appStateSource(): AppStateSource {
  const native = reactNative();
  if (!native) return { current: () => 'active', subscribe: () => () => {} };

  return {
    current: () => known(native.AppState.currentState),
    subscribe: (listener) => {
      const subscription = native.AppState.addEventListener('change', (state) =>
        listener(known(state)),
      );
      return () => subscription.remove();
    },
  };
}

@Service()
export class AppState {
  /** Overridden in a test to send the app to the background. */
  static readonly SOURCE = new InjectionToken<AppStateSource>('angular-native.appStateSource', {
    factory: appStateSource,
  });

  private readonly source = inject(AppState.SOURCE);

  /** Whether the service is here: on every OS, where it answers what the OS reports. */
  readonly available: Signal<boolean> = signal(true).asReadonly();
  private readonly state = signal<AppStatus>(this.source.current());

  readonly current: Signal<AppStatus> = this.state.asReadonly();
  /** In front of the user and taking input. */
  readonly active: Signal<boolean> = computed(() => this.state() === 'active');

  constructor() {
    inject(DestroyRef).onDestroy(this.source.subscribe((state) => this.state.set(state)));
  }
}
