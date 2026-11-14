/**
 * The platform modules on macOS, each through its service and the desktop host's TurboModule:
 * the JS adapters that turn what a TurboModule can pass (`{base64}` for bytes, events on
 * `DeviceEventEmitter` for listeners) into the shapes the Expo packages answer.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import { injectService } from '@ng-native/testing';

type Listener = (event: unknown) => void;

/** A Mac whose desktop host registers `modules`, with the events the host sends on `send`. */
function mac(modules: Record<string, object>) {
  const listeners = new Map<string, Set<Listener>>();
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
    return {
      Platform: { OS: 'macos' },
      TurboModuleRegistry: { get: (name: string) => modules[name] ?? null },
      DeviceEventEmitter: {
        addListener: (event: string, listener: Listener) => {
          const set = listeners.get(event) ?? new Set();
          listeners.set(event, set);
          set.add(listener);
          return { remove: () => void set.delete(listener) };
        },
      },
      Image: {
        resolveAssetSource: (id: number) => ({
          uri: `http://localhost:8081/assets/font-${id}.ttf`,
        }),
      },
    };
  };
  return {
    send: (event: string, body: unknown) => listeners.get(event)?.forEach((l) => l(body)),
    listening: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

describe('Crypto on macOS', () => {
  function host() {
    const calls: unknown[][] = [];
    mac({
      NgNativeCrypto: {
        randomUUID: () => 'a-uuid',
        getRandomBytes: (count: number) => {
          calls.push(['getRandomBytes', count]);
          return { base64: Buffer.alloc(count, 7).toString('base64') };
        },
        digestStringAsync: async (...args: unknown[]) => (
          calls.push(['digestString', ...args]),
          'ab'
        ),
        digestAsync: async (...args: unknown[]) => (
          calls.push(['digest', ...args]),
          { base64: 'AQID' }
        ),
      },
    });
    return calls;
  }

  it('answers bytes as a Uint8Array, and a digest as an ArrayBuffer', async () => {
    const calls = host();
    const { Crypto, CryptoDigestAlgorithm } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto);
    assert.equal(crypto.available(), true);
    assert.equal(crypto.randomUUID(), 'a-uuid');
    const bytes = crypto.randomBytes(3);
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual([...bytes], [7, 7, 7]);
    assert.deepEqual([...(await crypto.randomBytesAsync(2))], [7, 7]);
    const digest = await crypto.digest(CryptoDigestAlgorithm.SHA256, new Uint8Array([9, 8]));
    assert.ok(digest instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(digest)], [1, 2, 3]);
    assert.deepEqual(calls.at(-1), ['digest', 'SHA-256', { base64: 'CQg=' }]);
    assert.equal(await crypto.digestString(CryptoDigestAlgorithm.SHA1, 'x'), 'ab');
    assert.deepEqual(calls.at(-1), ['digestString', 'SHA-1', 'x', undefined]);
  });

  it('digests the bytes a view covers, not its whole buffer', async () => {
    const calls = host();
    const { Crypto, CryptoDigestAlgorithm } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto);
    const whole = new Uint8Array([1, 2, 3, 4]);
    await crypto.digest(CryptoDigestAlgorithm.SHA256, whole.subarray(1, 3));
    assert.deepEqual(calls.at(-1), ['digest', 'SHA-256', { base64: 'AgM=' }]);
  });

  it('fills getRandomValues 1024 bytes at a time', async () => {
    const calls = host();
    const { Crypto } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto);
    const array = new Uint16Array(1000);
    assert.equal(crypto.randomValues(array), array);
    assert.ok(array.every((value) => value === 0x0707));
    assert.deepEqual(calls, [
      ['getRandomBytes', 1024],
      ['getRandomBytes', 976],
    ]);
  });
});

describe('Network on macOS', () => {
  it('reads the state from NgNativeNetwork and follows its ngNativeNetwork events', async () => {
    const host = mac({
      NgNativeNetwork: {
        getNetworkStateAsync: async () => ({
          type: 'WIFI',
          isConnected: true,
          isInternetReachable: true,
        }),
      },
    });
    const { Network } = await import('@ng-native/expo/network');
    const network = injectService(Network);
    assert.equal(network.available(), true);
    await new Promise((resolve) => setTimeout(resolve));
    assert.deepEqual(network.status(), { connected: true, type: 'wifi', reachable: true });
    assert.equal(host.listening('ngNativeNetwork'), 1);
    host.send('ngNativeNetwork', { type: 'NONE', isConnected: false, isInternetReachable: false });
    assert.deepEqual(network.status(), { connected: false, type: 'none', reachable: false });
  });
});

describe('Battery on macOS', () => {
  it('reads NgNativeBattery and follows each kind of ngNativeBattery event', async () => {
    const host = mac({
      NgNativeBattery: {
        getBatteryLevelAsync: async () => 0.5,
        getBatteryStateAsync: async () => 1,
        isLowPowerModeEnabledAsync: async () => false,
        isAvailableAsync: async () => true,
      },
    });
    const { Battery } = await import('@ng-native/expo/battery');
    const battery = injectService(Battery);
    assert.equal(battery.available(), true);
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(battery.level(), 0.5);
    assert.equal(battery.state(), 'unplugged');
    assert.equal(battery.saving(), false);
    assert.equal(host.listening('ngNativeBattery'), 3);
    host.send('ngNativeBattery', { type: 'level', batteryLevel: 0.1 });
    assert.equal(battery.level(), 0.1);
    assert.equal(battery.low(), true);
    host.send('ngNativeBattery', { type: 'state', batteryState: 2 });
    assert.equal(battery.state(), 'charging');
    host.send('ngNativeBattery', { type: 'lowPowerMode', lowPowerMode: true });
    assert.equal(battery.saving(), true);
    assert.equal(battery.level(), 0.1);
    // Held below full on the adapter reads as full, as expo-battery's NOT_CHARGING does.
    host.send('ngNativeBattery', { type: 'state', batteryState: 4 });
    assert.equal(battery.state(), 'full');
  });

  it('reads a Mac with no battery as a level not known, and never low', async () => {
    mac({
      NgNativeBattery: {
        getBatteryLevelAsync: async () => -1,
        getBatteryStateAsync: async () => 0,
        isLowPowerModeEnabledAsync: async () => false,
      },
    });
    const { Battery } = await import('@ng-native/expo/battery');
    const battery = injectService(Battery);
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(battery.known(), false);
    assert.equal(battery.level(), 1);
    assert.equal(battery.state(), 'unknown');
    assert.equal(battery.low(), false);
  });
});

describe('Fonts on macOS', () => {
  function host() {
    const loaded: [string, string][] = [];
    mac({
      NgNativeFont: {
        loadAsync: async (name: string, uri: string) => {
          if (uri.includes('broken')) throw new Error('not a font');
          loaded.push([name, uri]);
        },
        isLoaded: (name: string) => loaded.some(([loadedName]) => loadedName === name),
        getLoadedFonts: () => loaded.map(([name]) => name),
      },
    });
    return loaded;
  }

  it('loads each face by the uri its source names, an asset resolved as an image is', async () => {
    const loaded = host();
    const { Fonts } = await import('@ng-native/expo/fonts');
    const fonts = injectService(Fonts);
    assert.equal(fonts.available(), true);
    await fonts.load({ Inter: 7, Mono: 'file:///fonts/mono.otf', Serif: { uri: 'file:///s.ttf' } });
    assert.deepEqual(loaded, [
      ['Inter', 'http://localhost:8081/assets/font-7.ttf'],
      ['Mono', 'file:///fonts/mono.otf'],
      ['Serif', 'file:///s.ttf'],
    ]);
    assert.equal(fonts.has('Inter'), true);
    assert.deepEqual(fonts.families(), ['Inter', 'Mono', 'Serif']);
  });

  it('rejects a face the host cannot load, and one with no file', async () => {
    host();
    const { Fonts } = await import('@ng-native/expo/fonts');
    const fonts = injectService(Fonts);
    await assert.rejects(fonts.load({ Broken: 'file:///broken.ttf' }), /not a font/);
    await assert.rejects(fonts.load({ Nothing: null }), /Nothing has no file/);
    assert.equal(fonts.has('Broken'), false);
  });
});

describe('TextRecognition on macOS', () => {
  it("reads through the desktop host's NgNativeTextRecognition", async () => {
    const asked: unknown[] = [];
    const read = { text: 'Hi', lines: [], width: 2, height: 1 };
    mac({
      NgNativeTextRecognition: {
        recognize: async (...args: unknown[]) => (asked.push(args), read),
      },
    });
    const { TextRecognition } = await import('@ng-native/expo/text-recognition');
    const recognition = injectService(TextRecognition);
    assert.equal(recognition.available(), true);
    assert.deepEqual(await recognition.recognize('file:///a.png', { languages: ['zh-TW'] }), read);
    assert.deepEqual(asked, [['file:///a.png', { languages: ['zh-Hant'] }]]);
  });

  it('says to rebuild the desktop host when it has no such module', async () => {
    mac({});
    const { TextRecognition } = await import('@ng-native/expo/text-recognition');
    const recognition = injectService(TextRecognition);
    assert.equal(recognition.available(), false);
    await assert.rejects(recognition.recognize('file:///a.png'), /npm run macos/);
  });
});

describe('Calendar on macOS', () => {
  function host(granted: boolean) {
    const calls: unknown[][] = [];
    const permission = {
      status: granted ? 'granted' : 'denied',
      granted,
      canAskAgain: false,
      expires: 'never',
    };
    const record =
      (name: string, answer: unknown) =>
      async (...args: unknown[]) => (calls.push([name, ...args]), answer);
    mac({
      NgNativeCalendar: {
        getCalendarPermissionsAsync: record('getCalendarPermissionsAsync', permission),
        requestCalendarPermissionsAsync: record('requestCalendarPermissionsAsync', permission),
        getRemindersPermissionsAsync: record('getRemindersPermissionsAsync', permission),
        getCalendarsAsync: record('getCalendarsAsync', granted ? [{ id: 'c1' }] : []),
        getCalendarAsync: record('getCalendarAsync', null),
        listEventsAsync: record('listEventsAsync', granted ? [{ id: 'e1' }] : []),
        getEventAsync: record('getEventAsync', null),
        getDefaultCalendarSync: () => (granted ? { id: 'c1' } : null),
        getSourcesSync: () => [],
      },
    });
    return calls;
  }

  it('answers a denied permission, and reads nothing', async () => {
    const calls = host(false);
    const { Calendar } = await import('@ng-native/expo/calendar');
    const calendar = injectService(Calendar);
    assert.equal(calendar.available(), true);
    assert.equal(await calendar.permission.request(), false);
    assert.equal(calendar.permission.status(), 'denied');
    assert.deepEqual(await calendar.calendars(), []);
    assert.equal(calendar.defaultCalendar(), null);
    assert.equal(await calendar.calendar('c1'), null);
    assert.equal(await calendar.reminder('r1'), null);
    assert.equal(await calendar.pickCalendar(), null);
    assert.deepEqual(calls.slice(0, 2), [
      ['requestCalendarPermissionsAsync', false],
      ['getCalendarsAsync', 'event'],
    ]);
  });

  it('lists events by calendar id, with the dates as milliseconds', async () => {
    const calls = host(true);
    const { Calendar } = await import('@ng-native/expo/calendar');
    const calendar = injectService(Calendar);
    assert.equal(await calendar.writePermission.check(), true);
    const start = new Date(1_000);
    const end = new Date(2_000);
    const events = await calendar.events(['c1', { id: 'c2' } as never], start, end);
    assert.deepEqual(events, [{ id: 'e1' }]);
    assert.deepEqual(calls.slice(-1), [['listEventsAsync', ['c1', 'c2'], 1_000, 2_000]]);
    assert.deepEqual(calls[0], ['getCalendarPermissionsAsync', true]);
    await assert.rejects(calendar.createCalendar({ title: 'x' }), /not available on macOS/);
  });
});

describe('Audio on macOS', () => {
  /** A desktop host's NgNativeAudio, recording each call. */
  function audioHost(statuses: Record<string, unknown> = {}) {
    const calls: unknown[][] = [];
    const record =
      (name: string, answer?: unknown) =>
      (...args: unknown[]) => (calls.push([name, ...args]), answer);
    const host = mac({
      NgNativeAudio: {
        createPlayer: record('createPlayer', '7'),
        replace: record('replace'),
        release: record('release'),
        play: record('play'),
        pause: record('pause'),
        seekTo: async (...args: unknown[]) => void calls.push(['seekTo', ...args]),
        setPlaybackRate: record('setPlaybackRate'),
        setVolume: record('setVolume'),
        setMuted: record('setMuted'),
        setLoop: record('setLoop'),
        status: (id: string) => statuses[id] ?? null,
        createRecorder: record('createRecorder', '8'),
        prepareToRecordAsync: async () => {
          throw new Error(
            'AudioRecorder.prepareToRecordAsync: recording permission has not been granted',
          );
        },
        recorderStatus: (id: string) => statuses[id] ?? null,
        releaseRecorder: record('releaseRecorder'),
        getRecordingPermissionsAsync: async () => ({ status: 'denied', granted: false }),
      },
    });
    return { host, calls };
  }

  it("plays through NgNativeAudio, and follows only its own player's status events", async () => {
    const { host, calls } = audioHost({ '7': { currentTime: 1.5, duration: 3, playing: true } });
    const { audioPlayer } = await import('@ng-native/expo/audio');
    const injector = Injector.create({ providers: [] });
    const owned = runInInjectionContext(injector, () =>
      audioPlayer(12 as never, { timeUpdate: 0.25 }),
    );
    // An asset resolved as an image is, and the interval in milliseconds.
    assert.deepEqual(calls[0], ['createPlayer', 'http://localhost:8081/assets/font-12.ttf', 250]);
    const player = owned.native;
    assert.equal(player.currentTime, 1.5);
    assert.equal(player.duration, 3);
    player.volume = 0.5;
    player.muted = true;
    player.loop = true;
    player.setPlaybackRate(4);
    player.play();
    await player.seekTo(2);
    assert.equal(player.volume, 0.5);
    assert.equal(player.playbackRate, 2);
    assert.deepEqual(calls.slice(1), [
      ['setVolume', '7', 0.5],
      ['setMuted', '7', true],
      ['setLoop', '7', true],
      ['setPlaybackRate', '7', 2],
      ['play', '7'],
      ['seekTo', '7', 2],
    ]);

    const status = {
      playing: true,
      mute: false,
      duration: 3,
      currentTime: 2,
      isLoaded: true,
      didJustFinish: false,
      error: null,
    };
    host.send('ngNativeAudio', {
      type: 'playbackStatusUpdate',
      id: '6',
      status: { ...status, currentTime: 9 },
    });
    assert.equal(owned.state().status, 'idle');
    host.send('ngNativeAudio', { type: 'playbackStatusUpdate', id: '7', status });
    assert.equal(owned.state().status, 'readyToPlay');
    assert.equal(owned.state().currentTime, 2);
    assert.equal(owned.state().volume, 0.5);

    injector.destroy();
    assert.deepEqual(calls.at(-1), ['release', '7']);
    assert.equal(host.listening('ngNativeAudio'), 0);
  });

  it('makes a recorder with the iOS options, and rejects a prepare the host refuses', async () => {
    const { calls } = audioHost();
    const { audioRecorder } = await import('@ng-native/expo/audio');
    const injector = Injector.create({ providers: [] });
    try {
      const owned = runInInjectionContext(injector, () =>
        audioRecorder({
          extension: '.m4a',
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          ios: { outputFormat: 'aac ', audioQuality: 96 },
          android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
          web: { mimeType: 'audio/webm' },
        }),
      );
      assert.deepEqual(calls[0], [
        'createRecorder',
        {
          extension: '.m4a',
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          isMeteringEnabled: false,
          directory: undefined,
          outputFormat: 'aac ',
          audioQuality: 96,
        },
      ]);
      assert.equal(owned.state().canRecord, false);
      await assert.rejects(owned.native.prepareToRecordAsync(), /permission has not been granted/);
    } finally {
      injector.destroy();
    }
    assert.deepEqual(calls.at(-1), ['releaseRecorder', '8']);
  });

  it('says to rebuild the desktop host when it has no NgNativeAudio', async () => {
    mac({});
    const { audioPlayer } = await import('@ng-native/expo/audio');
    const injector = Injector.create({ providers: [] });
    assert.throws(
      () => runInInjectionContext(injector, () => audioPlayer('file:///a.wav')),
      /expo-audio has no module in this build of the desktop host/,
    );
  });
});

describe('LanguageModel on macOS', () => {
  function llmHost(availability = 'available') {
    const calls: unknown[][] = [];
    const host = mac({
      NgNativeLocalLlm: {
        getAvailability: () => availability,
        downloadModel: async () => {},
        createSession: (config: unknown) => (calls.push(['createSession', config]), '3'),
        respond: async (...args: unknown[]) => (calls.push(['respond', ...args]), 'Blue'),
        streamResponse: async (id: string, prompt: string, requestId: string) => {
          calls.push(['streamResponse', id, prompt]);
          host.send('ngNativeLocalLlm', {
            type: 'token',
            session: '9',
            requestId,
            accumulated: 'Not this',
          });
          host.send('ngNativeLocalLlm', {
            type: 'token',
            session: id,
            requestId,
            accumulated: 'Once',
          });
          if (prompt === 'Too long') {
            throw new Error('ERR_CONTEXT_WINDOW_EXCEEDED: Exceeded the context window');
          }
          host.send('ngNativeLocalLlm', {
            type: 'toolCall',
            session: id,
            requestId,
            callId: 'c1',
            toolName: 'weather',
            arguments: { city: 'Leeds' },
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return 'Once upon a time';
        },
        cancelStream: async () => {},
        release: (id: string) => void calls.push(['release', id]),
        resolveToolCall: (...args: unknown[]) => void calls.push(['resolveToolCall', ...args]),
        rejectToolCall: (...args: unknown[]) => void calls.push(['rejectToolCall', ...args]),
      },
    });
    return { host, calls };
  }

  it("generates through NgNativeLocalLlm with expo-local-llm's config, and releases the session", async () => {
    const { calls } = llmHost();
    const { LanguageModel } = await import('@ng-native/expo/language-model');
    const model = injectService(LanguageModel);
    assert.equal(model.availability(), 'available');
    assert.equal(
      await model.generate('Sky?', { instructions: 'Be brief', temperature: 0.2 }),
      'Blue',
    );
    assert.deepEqual(calls, [
      ['createSession', { instructions: 'Be brief', options: { temperature: 0.2 } }],
      ['respond', '3', 'Sky?', null],
      ['release', '3'],
    ]);
  });

  it("streams only its own session's tokens, and answers the model's tool calls", async () => {
    const { calls } = llmHost();
    const { LanguageModel, defineTool } = await import('@ng-native/expo/language-model');
    const model = injectService(LanguageModel);
    const weather = defineTool({
      name: 'weather',
      description: 'The weather in a city',
      parameters: { city: { type: 'string', description: 'The city' } },
      handler: ({ city }) => `Rain in ${city}`,
    });
    const injector = Injector.create({ providers: [] });
    try {
      const session = model.session({ tools: [weather], injector });
      const reply = session.stream('Tell me');
      assert.equal(await reply.result, 'Once upon a time');
      assert.equal(reply.text(), 'Once upon a time');
      assert.deepEqual(
        calls.find(([name]) => name === 'resolveToolCall'),
        ['resolveToolCall', '3', 'c1', 'Rain in Leeds'],
      );
    } finally {
      injector.destroy();
    }
  });

  it("turns the host's coded failure into expo-local-llm's, and reads the model's absence", async () => {
    llmHost();
    const { LanguageModel, LanguageModelContextExceededError } =
      await import('@ng-native/expo/language-model');
    const model = injectService(LanguageModel);
    const injector = Injector.create({ providers: [] });
    try {
      const session = model.session({ injector });
      await assert.rejects(session.respond('Too long'), LanguageModelContextExceededError);
    } finally {
      injector.destroy();
    }
  });

  it('answers notEligible where the Mac has no on-device model', async () => {
    llmHost('notEligible');
    const { LanguageModel, LanguageModelUnavailableError } =
      await import('@ng-native/expo/language-model');
    const model = injectService(LanguageModel);
    assert.equal(model.availability(), 'notEligible');
    await assert.rejects(model.generate('Hi'), LanguageModelUnavailableError);
  });
});

describe('ScreenCapture on macOS', () => {
  it('prevents and allows capture by key through NgNativeScreenCapture, and counts no screenshot', async () => {
    const calls: unknown[][] = [];
    const record =
      (name: string, answer?: unknown) =>
      async (...args: unknown[]) => (calls.push([name, ...args]), answer);
    mac({
      NgNativeScreenCapture: {
        isAvailableAsync: async () => true,
        preventScreenCaptureAsync: record('prevent'),
        allowScreenCaptureAsync: record('allow'),
        enableAppSwitcherProtectionAsync: record('enableAppSwitcher'),
        disableAppSwitcherProtectionAsync: record('disableAppSwitcher'),
        getPermissionsAsync: async () => ({ status: 'granted', granted: true }),
        requestPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      },
    });
    const { ScreenCapture } = await import('@ng-native/expo/screen-capture');
    const capture = injectService(ScreenCapture);
    assert.equal(capture.available(), false);
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(capture.available(), true);
    await capture.prevent('card');
    await capture.prevent();
    await capture.allow('card');
    await capture.protectAppSwitcher();
    assert.deepEqual(calls, [
      ['prevent', 'card'],
      ['prevent', null],
      ['allow', 'card'],
      ['enableAppSwitcher'],
    ]);
    assert.equal(capture.screenshots(), 0);
  });
});

describe('SplashScreen on macOS', () => {
  it("holds and hides the first windows through the desktop host's NgNativeSplashScreen", async () => {
    const calls: string[] = [];
    mac({
      NgNativeSplashScreen: {
        preventAutoHideAsync: async () => (calls.push('hold'), true),
        hideAsync: async () => void calls.push('hide'),
      },
    });
    const { Splash, expoSplashScreen } = await import('@ng-native/expo/splash-screen');
    const splash = new Splash(expoSplashScreen);
    assert.equal(splash.available(), true);
    splash.hold();
    await splash.hideWhenReady(Promise.resolve(), async () => {});
    assert.deepEqual(calls, ['hold', 'hide']);
  });
});

describe('MediaLibrary on macOS', () => {
  function photos(granted: boolean) {
    const calls: unknown[][] = [];
    const record =
      (name: string, answer?: unknown) =>
      async (...args: unknown[]) => (calls.push([name, ...args]), answer);
    const permission = { status: granted ? 'granted' : 'denied', granted, canAskAgain: false };
    const host = mac({
      NgNativeMediaLibrary: {
        getPermissionsAsync: async () => permission,
        requestPermissionsAsync: record('request', permission),
        query: record('query', granted ? ['a1'] : []),
        queryMetadata: record('queryMetadata', []),
        asset: async (id: string) =>
          granted ? { id, filename: 'IMG_1.HEIC', width: 4, height: 3 } : null,
        uri: async () => 'file:///Photos/IMG_1.HEIC',
        albums: async () => (granted ? [{ id: 'al1', title: 'Holiday', type: 'album' }] : []),
        albumAssets: async () => ['a1'],
        createAsset: granted
          ? record('createAsset', 'new-1')
          : async () => {
              throw new Error('MediaLibrary: the app has no access to the photo library');
            },
        startObserving: () => (calls.push(['startObserving']), granted),
      },
    });
    return { host, calls };
  }

  it('builds a query as a plain description, and reads each asset when a getter asks', async () => {
    const { calls } = photos(true);
    const { MediaLibrary, AssetField, MediaType } = await import('@ng-native/expo/media-library');
    const library = injectService(MediaLibrary);
    const [album] = await library.albums();
    assert.equal(await album!.getTitle(), 'Holiday');
    const assets = await library.assets((query) =>
      query
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .limit(30)
        .album(album!),
    );
    assert.deepEqual(calls[0], [
      'query',
      {
        filters: [{ field: 'mediaType', op: 'eq', value: 'image' }],
        sort: [{ key: 'creationTime', ascending: false }],
        limit: 30,
        album: 'al1',
      },
    ]);
    assert.equal(assets[0]!.id, 'a1');
    assert.equal(await assets[0]!.getFilename(), 'IMG_1.HEIC');
    assert.deepEqual(await assets[0]!.getShape(), { width: 4, height: 3 });
    assert.equal(await assets[0]!.getUri(), 'file:///Photos/IMG_1.HEIC');
    const saved = await library.save('file:///tmp/a.jpg', album!);
    assert.equal(saved?.id, 'new-1');
    assert.deepEqual(calls.at(-1), ['createAsset', 'file:///tmp/a.jpg', 'al1']);
  });

  it('reads nothing and saves nothing without access, and starts watching only when asked', async () => {
    const { host, calls } = photos(false);
    const { MediaLibrary } = await import('@ng-native/expo/media-library');
    const library = injectService(MediaLibrary);
    assert.equal(library.available(), true);
    assert.deepEqual(await library.assets(), []);
    assert.deepEqual(await library.albums(), []);
    assert.equal(await library.save('file:///tmp/a.jpg'), null);
    assert.equal(calls.filter(([name]) => name === 'createAsset').length, 0);
    assert.equal(host.listening('ngNativeMediaLibrary'), 0);
    library.watch();
    assert.deepEqual(calls.at(-1), ['startObserving']);
    assert.equal(host.listening('ngNativeMediaLibrary'), 1);
  });
});

describe('ImagePicker on macOS', () => {
  it('picks from the library through NgNativeImagePicker, and answers a cancel with nothing', async () => {
    let canceled = true;
    mac({
      NgNativeImagePicker: {
        launchImageLibraryAsync: async () =>
          canceled
            ? { canceled: true, assets: null }
            : { canceled: false, assets: [{ uri: 'file:///c/p.jpg' }] },
        launchCameraAsync: async () => ({ canceled: true, assets: null }),
        getCameraPermissionsAsync: async () => ({
          status: 'denied',
          granted: false,
          canAskAgain: false,
        }),
        requestCameraPermissionsAsync: async () => ({
          status: 'denied',
          granted: false,
          canAskAgain: false,
        }),
      },
    });
    const { ImagePicker } = await import('@ng-native/expo/image-picker');
    const picker = injectService(ImagePicker);
    assert.deepEqual(await picker.pick(), []);
    canceled = false;
    assert.deepEqual(await picker.pick({ mediaTypes: ['images'] }), [{ uri: 'file:///c/p.jpg' }]);
    assert.deepEqual(await picker.capture(), []);
  });
});

describe('Tracking on macOS', () => {
  it("reads the permission and the identifier from the desktop host's NgNativeTrackingTransparency", async () => {
    mac({
      NgNativeTrackingTransparency: {
        isAvailable: () => true,
        getTrackingPermissionsAsync: async () => ({
          status: 'denied',
          granted: false,
          canAskAgain: false,
        }),
        requestTrackingPermissionsAsync: async () => ({
          status: 'denied',
          granted: false,
          canAskAgain: false,
        }),
        getAdvertisingId: () => null,
      },
    });
    const { Tracking } = await import('@ng-native/expo/tracking');
    const tracking = injectService(Tracking);
    assert.equal(tracking.available(), true);
    assert.equal(await tracking.permission.ensure(), false);
    assert.equal(tracking.advertisingId(), null);
  });
});

describe('ImageEditor on macOS', () => {
  it("edits through NgNativeImageManipulator, sending a context's actions whole", async () => {
    const calls: unknown[][] = [];
    mac({
      NgNativeImageManipulator: {
        renderAsync: async (...args: unknown[]) => (
          calls.push(['render', ...args]),
          { width: 50, height: 25 }
        ),
        saveAsync: async (...args: unknown[]) => (
          calls.push(['save', ...args]),
          { uri: 'file:///caches/ImageManipulator/A.webp', width: 50, height: 25 }
        ),
      },
    });
    const { ImageEditor, SaveFormat, FlipType } = await import('@ng-native/expo/image-editor');
    const editor = injectService(ImageEditor);
    assert.equal(editor.available(), true);
    const result = await editor.edit(
      'file:///photo.png',
      [{ resize: { width: 50 } }, { flip: FlipType.Vertical }, { rotate: 90 }],
      { format: SaveFormat.PNG, compress: 0.5 },
    );
    assert.deepEqual(result, {
      uri: 'file:///caches/ImageManipulator/A.webp',
      width: 50,
      height: 25,
    });
    const actions = [{ resize: { width: 50 } }, { flip: 'vertical' }, { rotate: 90 }];
    assert.deepEqual(calls, [
      ['render', 'file:///photo.png', actions, null],
      ['save', 'file:///photo.png', actions, null, { format: 'png', compress: 0.5 }],
    ]);

    // A context by hand: reset drops what came before, and the image keeps the actions it rendered.
    calls.length = 0;
    const context = editor.manipulate('data:image/png;base64,AAAA');
    assert.ok(context);
    context.crop({ originX: 1, originY: 2, width: 3, height: 4 }).reset().rotate(-90);
    const image = await context.renderAsync();
    context.flip(FlipType.Horizontal);
    assert.equal(image.width, 50);
    assert.equal(image.height, 25);
    await image.saveAsync();
    assert.deepEqual(calls, [
      ['render', 'data:image/png;base64,AAAA', [{ rotate: -90 }], null],
      ['save', 'data:image/png;base64,AAAA', [{ rotate: -90 }], null, {}],
    ]);
    context.release();
    image.release();
  });
});
