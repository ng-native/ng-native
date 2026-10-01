import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import { Watch, type NativeWatch, type WatchPayload } from '@ng-native/expo/watch';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeWatch(
  options: {
    reachable?: boolean;
    context?: WatchPayload | null;
    pairedFrom?: number;
    installed?: boolean;
  } = {},
) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: [string, ...unknown[]][] = [];
  let reachable = options.reachable ?? true;
  let failSend: Error | null = null;
  let pairedAsks = 0;
  const native: NativeWatch = {
    sendMessage: (message, reply, error) => {
      calls.push(['sendMessage', message]);
      if (failSend) error?.(failSend);
      else reply?.({ echo: message });
    },
    sendMessageData: async (data) => {
      calls.push(['sendMessageData', data]);
      return `${data} back`;
    },
    updateApplicationContext: (context) => calls.push(['updateApplicationContext', context]),
    getApplicationContext: async () => options.context ?? null,
    transferUserInfo: (info) => calls.push(['transferUserInfo', info]),
    transferCurrentComplicationUserInfo: (info) => calls.push(['complication', info]),
    startFileTransfer: async (uri, metadata) => {
      calls.push(['startFileTransfer', uri, metadata]);
      return 'transfer-1';
    },
    getReachability: async () => reachable,
    getIsPaired: async () => ++pairedAsks > (options.pairedFrom ?? 0),
    getIsWatchAppInstalled: async () => options.installed ?? true,
    watchEvents: {
      on: ((event: string, listener: (...args: unknown[]) => void) => {
        let set = listeners.get(event);
        if (!set) listeners.set(event, (set = new Set()));
        set.add(listener);
        return () => set.delete(listener);
      }) as NativeWatch['watchEvents']['on'],
    },
  };
  return {
    native,
    calls,
    emit: (event: string, ...args: unknown[]) =>
      listeners.get(event)?.forEach((listener) => listener(...args)),
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    setReachable: (value: boolean) => (reachable = value),
    failNextSends: (error: Error | null) => (failSend = error),
  };
}

function watchWith(native: NativeWatch | null) {
  const injector = Injector.create({ providers: [{ provide: Watch.SOURCE, useValue: native }] });
  const watch = runInInjectionContext(injector, () => new Watch());
  return { watch, destroy: () => (injector as unknown as { destroy(): void }).destroy() };
}

describe('Watch, without a watch', () => {
  it('is inert where the package is missing or the platform is not iOS', async () => {
    const { watch } = watchWith(null);
    assert.equal(watch.available, false);
    assert.deepEqual(await watch.status(), { paired: false, installed: false, reachable: false });
    await assert.rejects(watch.send({ a: 1 }), /react-native-watch-connectivity/);
    await assert.rejects(watch.sendData('x'));
    await assert.rejects(watch.sendFile('file:///a'));
    assert.equal(await watch.currentContext(), null);
    watch.update({ a: 1 });
    watch.transfer({ a: 1 });
    watch.transferComplication({ a: 1 });
  });
});

describe('Watch, with a paired watch', () => {
  it('reads paired, installed and reachable as it starts', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    await settle();
    assert.equal(watch.available, true);
    assert.equal(watch.paired(), true);
    assert.equal(watch.installed(), true);
    assert.equal(watch.reachable(), true);
  });

  it('asks again until the session has activated, which no event reports', async () => {
    const fake = fakeWatch({ pairedFrom: 1, reachable: false });
    const { watch } = watchWith(fake.native);
    await settle();
    assert.equal(watch.paired(), false, 'asked before the session had activated');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(watch.paired(), true);
  });

  it('reads paired and installed again when reachability changes', async () => {
    const fake = fakeWatch({ pairedFrom: 1, reachable: false });
    const { watch, destroy } = watchWith(fake.native);
    await settle();
    fake.emit('reachability', true);
    await settle();
    assert.equal(watch.paired(), true);
    destroy();
  });

  it('holds what is sent before the session has activated, and sends it once it has', async () => {
    const fake = fakeWatch({ pairedFrom: 1, reachable: false });
    const { watch, destroy } = watchWith(fake.native);
    watch.update({ value: 1 });
    watch.update({ value: 2 });
    watch.transfer({ score: 1 });
    watch.transferComplication({ score: 2 });
    await settle();
    assert.deepEqual(fake.calls, [], 'iOS drops a send before activation');

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(fake.calls, [
      ['updateApplicationContext', { value: 2 }],
      ['transferUserInfo', { score: 1 }],
      ['complication', { score: 2 }],
    ]);
    watch.update({ value: 3 });
    assert.deepEqual(fake.calls.at(-1), ['updateApplicationContext', { value: 3 }]);
    destroy();
  });

  it('counts a watch that answers as paired and installed, whatever iOS last said', async () => {
    const fake = fakeWatch({ installed: false, reachable: false });
    const { watch } = watchWith(fake.native);
    await settle();
    assert.equal(watch.installed(), false);
    fake.emit('message', { from: 'watch' }, null);
    assert.deepEqual([watch.paired(), watch.installed(), watch.reachable()], [true, true, true]);

    fake.setReachable(true);
    fake.emit('reachability', false);
    assert.deepEqual(await watch.status(), { paired: true, installed: true, reachable: true });
    assert.equal(watch.installed(), true);
  });

  it('becomes reachable once the watch is, though no event said so', async () => {
    const fake = fakeWatch({ reachable: false });
    const { watch } = watchWith(fake.native);
    await settle();
    assert.equal(watch.reachable(), false, 'asked before the session had activated');

    fake.setReachable(true);
    await watch.status();
    assert.equal(watch.reachable(), true, 'a status check sees it');

    fake.emit('reachability', false);
    assert.equal(watch.reachable(), false);
    fake.emit('message', { from: 'watch' }, null);
    assert.equal(watch.reachable(), true, 'a message from the watch proves it');
  });

  it('follows the reachability, paired and installed events', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    await settle();
    fake.emit('paired', false);
    fake.emit('installed', false);
    fake.emit('reachability', false);
    assert.deepEqual([watch.paired(), watch.installed(), watch.reachable()], [false, false, false]);
    fake.emit('reachability', true);
    fake.emit('session-did-deactivate', {});
    assert.equal(watch.reachable(), false, 'a deactivated session reaches nothing');
  });

  it("sends a live message and resolves to the watch's reply", async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    assert.deepEqual(await watch.send({ value: 4 }), { echo: { value: 4 } });
    assert.equal(watch.reachable(), true);
  });

  it('rejects a live message the watch cannot take, and is unreachable after', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    await settle();
    fake.failNextSends(new Error('not reachable'));
    await assert.rejects(watch.send({ value: 1 }), /not reachable/);
    assert.equal(watch.reachable(), false);
  });

  it('keeps the last message from the watch', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    fake.emit('message', { count: 20 }, null);
    assert.deepEqual(watch.message(), { count: 20 });
  });

  it('answers a message that wants a reply with what the handlers return', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    const replies: WatchPayload[] = [];
    watch.onMessage((message) => ({ seen: message['ask'] }));
    watch.onMessage(async () => ({ at: 'phone' }));
    fake.emit('message', { ask: 'time' }, (response: WatchPayload) => replies.push(response));
    await settle();
    assert.deepEqual(replies, [{ seen: 'time', at: 'phone' }]);
  });

  it('still replies when a handler throws or there is none, so the watch is not left waiting', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    const replies: WatchPayload[] = [];
    fake.emit('message', { ask: 1 }, (response: WatchPayload) => replies.push(response));
    const stop = watch.onMessage(() => {
      throw new Error('boom');
    });
    fake.emit('message', { ask: 2 }, (response: WatchPayload) => replies.push(response));
    await settle();
    assert.deepEqual(replies, [{}, {}]);

    stop();
    const heard: WatchPayload[] = [];
    watch.onMessage((message) => void heard.push(message));
    watch.onMessage(() => {
      throw new Error('boom');
    });
    watch.onMessage(async () => {
      throw new Error('boom');
    });
    watch.onMessage((message) => void heard.push(message));
    fake.emit('message', { tell: 3 }, null);
    await settle();
    assert.deepEqual(
      heard,
      [{ tell: 3 }, { tell: 3 }],
      'every handler hears a message that wants no reply, past one that throws',
    );
  });

  it('sends raw data', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    assert.equal(await watch.sendData('ping'), 'ping back');
  });

  it('updates the shared context, and reads the one the watch sends', async () => {
    const fake = fakeWatch({ context: { value: 'from before' } });
    const { watch } = watchWith(fake.native);
    await settle();
    assert.deepEqual(watch.context(), { value: 'from before' }, 'the last one, as it starts');
    watch.update({ value: 13 });
    assert.deepEqual(fake.calls.at(-1), ['updateApplicationContext', { value: 13 }]);
    fake.emit('application-context', { value: 'from the watch' });
    assert.deepEqual(watch.context(), { value: 'from the watch' });
    assert.deepEqual(await watch.currentContext(), { value: 'from before' });
  });

  it('queues user info and complication updates, and keeps what the watch queued', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    await settle();
    watch.transfer({ score: 90 });
    watch.transferComplication({ score: 91 });
    assert.deepEqual(fake.calls.slice(-2), [
      ['transferUserInfo', { score: 90 }],
      ['complication', { score: 91 }],
    ]);
    fake.emit('user-info', [{ a: 1 }, { b: 2 }]);
    fake.emit('user-info', [{ c: 3 }]);
    assert.deepEqual(watch.userInfo(), [{ a: 1 }, { b: 2 }, { c: 3 }], 'every delivery, in order');
  });

  it('starts a file transfer and follows its progress', async () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    assert.equal(await watch.sendFile('file:///a.png', { kind: 'photo' }), 'transfer-1');
    assert.deepEqual(fake.calls.at(-1), ['startFileTransfer', 'file:///a.png', { kind: 'photo' }]);

    const base = {
      id: 'transfer-1',
      uri: 'file:///a.png',
      metadata: {},
      bytesTotal: 10,
      startTime: new Date(0),
      endTime: null,
      error: null,
    };
    fake.emit('file', { ...base, type: 'progress', bytesTransferred: 5, fractionCompleted: 0.5 });
    assert.equal(watch.transfers().get('transfer-1')?.fractionCompleted, 0.5);
    fake.emit('file', { ...base, type: 'finished', bytesTransferred: 10, fractionCompleted: 1 });
    assert.equal(watch.transfers().get('transfer-1')?.fractionCompleted, 1);

    fake.emit('file-received', [{ url: 'file:///b.png' }]);
    assert.deepEqual(watch.files(), [{ url: 'file:///b.png' }]);
  });

  it('reports each kind of session error', () => {
    const fake = fakeWatch();
    const { watch } = watchWith(fake.native);
    for (const [event, kind] of [
      ['activation-error', 'activation'],
      ['application-context-error', 'application-context'],
      ['application-context-received-error', 'application-context-received'],
      ['user-info-error', 'user-info'],
      ['file-received-error', 'file-received'],
    ] as const) {
      fake.emit(event, { why: event });
      assert.deepEqual(watch.error(), { kind, payload: { why: event } });
    }
  });

  it('stops listening when the app is destroyed', () => {
    const fake = fakeWatch();
    const { destroy } = watchWith(fake.native);
    assert.ok(fake.listening() > 0);
    destroy();
    assert.equal(fake.listening(), 0);
  });
});
