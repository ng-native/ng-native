import {
  DestroyRef,
  ErrorHandler,
  InjectionToken,
  Service,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { expoModule } from './native.ts';

export type WatchPayload = Record<string, unknown>;

export interface WatchFileTransfer {
  readonly id: string;
  readonly uri: string;
  readonly metadata: WatchPayload;
  readonly bytesTotal: number;
  readonly bytesTransferred: number;
  readonly fractionCompleted: number;
  readonly startTime: Date;
  readonly endTime: Date | null;
  readonly error: Error | null;
}

export interface WatchFileEvent extends WatchFileTransfer {
  readonly type: string;
}

export interface WatchError {
  readonly kind:
    | 'activation'
    | 'application-context'
    | 'application-context-received'
    | 'user-info'
    | 'file-received';
  readonly payload: unknown;
}

type Unsubscribe = () => void;
type Reply = ((response: WatchPayload) => void) | null;

export interface NativeWatch {
  sendMessage(
    message: WatchPayload,
    reply?: (response: WatchPayload) => void,
    error?: (error: Error) => void,
  ): void;
  sendMessageData(data: string): Promise<string>;
  updateApplicationContext(context: WatchPayload): void;
  getApplicationContext(): Promise<WatchPayload | null>;
  transferUserInfo(userInfo: WatchPayload): void;
  transferCurrentComplicationUserInfo(userInfo: WatchPayload): void;
  startFileTransfer(uri: string, metadata?: WatchPayload): Promise<string>;
  getReachability(): Promise<boolean>;
  getIsPaired(): Promise<boolean>;
  getIsWatchAppInstalled(): Promise<boolean>;
  watchEvents: {
    on(event: 'message', listener: (message: WatchPayload, reply: Reply) => void): Unsubscribe;
    on(event: 'application-context', listener: (context: WatchPayload) => void): Unsubscribe;
    on(event: 'user-info', listener: (userInfo: WatchPayload[]) => void): Unsubscribe;
    on(event: 'file', listener: (event: WatchFileEvent) => void): Unsubscribe;
    on(event: 'file-received', listener: (files: WatchPayload[]) => void): Unsubscribe;
    on(
      event: 'reachability' | 'paired' | 'installed',
      listener: (value: boolean) => void,
    ): Unsubscribe;
    on(
      event:
        | 'activation-error'
        | 'application-context-error'
        | 'application-context-received-error'
        | 'user-info-error'
        | 'file-received-error'
        | 'session-became-inactive'
        | 'session-did-deactivate',
      listener: (payload: unknown) => void,
    ): Unsubscribe;
  };
}

export type WatchMessageHandler = (
  message: WatchPayload,
) => WatchPayload | void | Promise<WatchPayload | void>;

const ERRORS = [
  ['activation-error', 'activation'],
  ['application-context-error', 'application-context'],
  ['application-context-received-error', 'application-context-received'],
  ['user-info-error', 'user-info'],
  ['file-received-error', 'file-received'],
] as const;

const SETTLE_DELAYS = [0, 250, 1000, 3000, 10000];

@Service()
export class Watch {
  /**
   * `react-native-watch-connectivity`, iOS only. It is a TurboModule, which it asks for with
   * `getEnforcing` as it is evaluated, so it is evaluated only once `WatchConnectivity` is
   * registered: in Expo Go, or a build made before it was installed, it would throw an invariant
   * Metro reports as fatal rather than the `MissingModuleError` this answers.
   */
  static readonly SOURCE = new InjectionToken<NativeWatch | null>('angular-native.watchSource', {
    factory: () =>
      expoModule(
        'react-native-watch-connectivity',
        () =>
          (require('react-native') as typeof import('react-native')).TurboModuleRegistry?.get(
            'WatchConnectivity',
          )
            ? (require('react-native-watch-connectivity') as NativeWatch)
            : null,
        ['ios'],
      ),
  });

  private readonly native = inject(Watch.SOURCE);
  private readonly handlers = new Set<WatchMessageHandler>();
  private readonly errors = inject(ErrorHandler);
  private destroyed = false;
  private ready = false;
  private pendingContext: WatchPayload | null = null;
  private readonly pendingTransfers: [complication: boolean, userInfo: WatchPayload][] = [];

  private readonly pairedState = signal(false);
  private readonly installedState = signal(false);
  private readonly reachableState = signal(false);
  private readonly messageState = signal<WatchPayload | null>(null);
  private readonly contextState = signal<WatchPayload | null>(null);
  private readonly userInfoState = signal<readonly WatchPayload[]>([]);
  private readonly filesState = signal<readonly WatchPayload[]>([]);
  private readonly transfersState = signal<ReadonlyMap<string, WatchFileEvent>>(new Map());
  private readonly errorState = signal<WatchError | null>(null);

  readonly available = this.native !== null;
  readonly paired: Signal<boolean> = this.pairedState.asReadonly();
  readonly installed: Signal<boolean> = this.installedState.asReadonly();
  readonly reachable: Signal<boolean> = this.reachableState.asReadonly();
  readonly message: Signal<WatchPayload | null> = this.messageState.asReadonly();
  readonly context: Signal<WatchPayload | null> = this.contextState.asReadonly();
  readonly userInfo: Signal<readonly WatchPayload[]> = this.userInfoState.asReadonly();
  readonly files: Signal<readonly WatchPayload[]> = this.filesState.asReadonly();
  readonly transfers: Signal<ReadonlyMap<string, WatchFileEvent>> =
    this.transfersState.asReadonly();
  readonly error: Signal<WatchError | null> = this.errorState.asReadonly();

  constructor() {
    const native = this.native;
    if (!native) return;
    const events = native.watchEvents;
    const stops: Unsubscribe[] = [
      events.on('reachability', (reachable) => {
        if (reachable) this.connected();
        else this.reachableState.set(false);
        void this.status().catch(() => {});
      }),
      events.on('paired', (paired) => {
        this.pairedState.set(paired);
        // A watch paired after `settle` stopped asking: the session is active, so send what it held.
        if (paired) this.activated();
      }),
      events.on('installed', (installed) => this.installedState.set(installed)),
      events.on('message', (message, reply) => this.received(message, reply)),
      events.on('application-context', (context) => this.contextState.set(context)),
      events.on('user-info', (userInfo) =>
        this.userInfoState.update((received) => [...received, ...userInfo]),
      ),
      events.on('file-received', (files) => this.filesState.set(files)),
      events.on('file', (event) =>
        this.transfersState.update((transfers) => new Map(transfers).set(event.id, event)),
      ),
      events.on('session-became-inactive', () => this.reachableState.set(false)),
      events.on('session-did-deactivate', () => this.reachableState.set(false)),
      ...ERRORS.map(([event, kind]) =>
        events.on(event, (payload) => this.errorState.set({ kind, payload })),
      ),
    ];
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      stops.forEach((stop) => stop());
    });
    void this.settle();
    native.getApplicationContext().then(
      (context) => context && this.contextState.set(context),
      () => {},
    );
  }

  async status(): Promise<{ paired: boolean; installed: boolean; reachable: boolean }> {
    const native = this.native;
    if (!native) return { paired: false, installed: false, reachable: false };
    const [paired, installed, reachable] = await Promise.all([
      native.getIsPaired(),
      native.getIsWatchAppInstalled(),
      native.getReachability(),
    ]);
    if (reachable) {
      this.connected();
      return { paired: true, installed: true, reachable };
    }
    this.pairedState.set(paired);
    this.installedState.set(installed);
    this.reachableState.set(false);
    if (paired) this.activated();
    return { paired, installed, reachable };
  }

  send(message: WatchPayload): Promise<WatchPayload> {
    const native = this.native;
    if (!native) return Promise.reject(unavailable());
    return new Promise((resolve, reject) =>
      native.sendMessage(
        message,
        (response) => {
          this.connected();
          resolve(response);
        },
        (error) => {
          this.reachableState.set(false);
          reject(error);
        },
      ),
    );
  }

  sendData(data: string): Promise<string> {
    return this.native ? this.native.sendMessageData(data) : Promise.reject(unavailable());
  }

  onMessage(handler: WatchMessageHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  update(context: WatchPayload): void {
    if (!this.native) return;
    if (this.ready) this.native.updateApplicationContext(context);
    else this.pendingContext = context;
  }

  currentContext(): Promise<WatchPayload | null> {
    return this.native ? this.native.getApplicationContext() : Promise.resolve(null);
  }

  transfer(userInfo: WatchPayload): void {
    this.queue(false, userInfo);
  }

  transferComplication(userInfo: WatchPayload): void {
    this.queue(true, userInfo);
  }

  sendFile(uri: string, metadata: WatchPayload = {}): Promise<string> {
    return this.native
      ? this.native.startFileTransfer(uri, metadata)
      : Promise.reject(unavailable());
  }

  private queue(complication: boolean, userInfo: WatchPayload): void {
    const native = this.native;
    if (!native) return;
    if (!this.ready) this.pendingTransfers.push([complication, userInfo]);
    else if (complication) native.transferCurrentComplicationUserInfo(userInfo);
    else native.transferUserInfo(userInfo);
  }

  private connected(): void {
    this.pairedState.set(true);
    this.installedState.set(true);
    this.reachableState.set(true);
    this.activated();
  }

  private activated(): void {
    if (this.ready) return;
    this.ready = true;
    if (this.pendingContext) this.update(this.pendingContext);
    this.pendingContext = null;
    for (const [complication, userInfo] of this.pendingTransfers.splice(0)) {
      this.queue(complication, userInfo);
    }
  }

  private async settle(): Promise<void> {
    for (const delay of SETTLE_DELAYS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.destroyed) return;
      const status = await this.status().catch(() => null);
      if (status?.paired) return;
    }
  }

  private received(message: WatchPayload, reply: Reply): void {
    this.connected();
    this.messageState.set(message);
    if (!reply) {
      for (const handler of this.handlers) {
        void Promise.resolve()
          .then(() => handler(message))
          .catch((error: unknown) => this.errors.handleError(error));
      }
      return;
    }
    void this.answer(message).then(reply, (error: unknown) => {
      this.errors.handleError(error);
      reply({});
    });
  }

  private async answer(message: WatchPayload): Promise<WatchPayload> {
    let response: WatchPayload = {};
    for (const handler of this.handlers) {
      const result = await handler(message);
      if (result) response = { ...response, ...result };
    }
    return response;
  }
}

function unavailable(): Error {
  return new Error(
    'No paired Apple Watch session: react-native-watch-connectivity is not installed, or this is not iOS.',
  );
}
