import {
  Component,
  Injector,
  effect,
  inject,
  input,
  runInInjectionContext,
  signal,
  viewChild,
} from '@angular/core';
import { TurboModuleRegistry } from 'react-native';
import { ScrollView, Text, View } from '@ng-native/components';
import { audioPlayer, audioRecorder, recordingPermission } from '@ng-native/expo/audio';
import { Calendar, EntityTypes } from '@ng-native/expo/calendar';
import { registerExpoViews } from '@ng-native/expo';
import { Camera, cameraPermission, microphonePermission } from '@ng-native/expo/camera';
import { ImagePicker } from '@ng-native/expo/image-picker';
import { Location } from '@ng-native/expo/location';
import { MapView } from '@ng-native/expo/map-view';
import { MediaLibrary } from '@ng-native/expo/media-library';

type Album = NonNullable<Awaited<ReturnType<MediaLibrary['album']>>>;
import { Notifications } from '@ng-native/expo/notifications';
import { Tracking } from '@ng-native/expo/tracking';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

type Module = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** A host module by name, for what no service reads on macOS, and the raw permission reads. */
function host(name: string): Module | null {
  return TurboModuleRegistry.get(name) as Module | null;
}

// Not registered in main.ts: only this screen draws a camera.
registerExpoViews('expo-camera');

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * The checks that need a permission someone grants: each runs from a launch link,
 * `canary://permissions?run=<check>`, and logs every step on screen and to the console as
 * `[perm] ...`, so a run can be read from the dev server's output. Everything it creates (a
 * calendar, an album, a photo) it deletes again.
 */
@Component({
  selector: 'x-permissions',
  imports: [Camera, MapView, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header title="Permissions" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="heading">{{ run() || 'no check' }}</text>
      @switch (cameraShown()) {
        @case ('picture') {
          <expo-camera
            class="perm-camera"
            (cameraReady)="note('cameraReady')"
            (mountError)="note('mountError ' + json($event))"
          />
        }
        @case ('muted') {
          <expo-camera
            class="perm-camera"
            mode="video"
            mute
            (cameraReady)="note('cameraReady muted')"
          />
        }
        @case ('sound') {
          <expo-camera class="perm-camera" mode="video" (cameraReady)="note('cameraReady sound')" />
        }
      }
      @if (mapShown()) {
        <expo-map class="perm-camera" [properties]="mapProperties" [cameraPosition]="mapCamera()" />
      }
      @for (line of lines(); track $index) {
        <text class="body">{{ line }}</text>
      }
    </scroll-view>
  `,
  styles: `
    .perm-camera {
      height: 240px;
      border-radius: 8px;
    }
  `,
})
export class PermissionsPage {
  readonly run = input<string>('');
  readonly file = input<string>('');

  private readonly camera = viewChild(Camera);
  private readonly injector = inject(Injector);
  private readonly calendar = inject(Calendar);
  private readonly location = inject(Location);
  private readonly media = inject(MediaLibrary);
  private readonly picker = inject(ImagePicker);
  private readonly tracking = inject(Tracking);
  private readonly notifications = inject(Notifications);
  private readonly cameraAccess = cameraPermission();
  private readonly microphone = microphonePermission();
  private readonly recording = recordingPermission();
  private readonly recorder = audioRecorder({
    extension: '.m4a',
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    ios: { outputFormat: 'aac ', audioQuality: 96 },
  } as never);

  protected readonly page = page;
  protected readonly lines = signal<string[]>([]);
  protected readonly cameraShown = signal<'none' | 'picture' | 'muted' | 'sound'>('none');
  protected readonly mapShown = signal(false);
  protected readonly mapCamera = signal({
    coordinates: { latitude: 51.5, longitude: -0.12 },
    zoom: 13,
  });
  protected readonly mapProperties = { isMyLocationEnabled: true };

  constructor() {
    let started = false;
    effect(() => {
      const check = this.run();
      if (started || !check) return;
      started = true;
      void this.start(check);
    });
    effect(() => {
      const latest = this.notifications.latest();
      if (latest)
        this.note(`latest() ${latest.request.identifier} ${latest.request.content.title}`);
    });
    effect(() => {
      const response = this.notifications.response();
      if (response) {
        this.note(
          `response() ${response.notification.request.identifier} ${response.actionIdentifier}`,
        );
      }
    });
    effect(() => {
      const position = this.location.position();
      if (position) {
        this.note(
          `position ` +
            `+-${Math.round(position.accuracy ?? -1)}m at ${new Date(position.timestamp).toISOString()}`,
        );
      }
    });
  }

  protected note(line: string): void {
    console.log(`[perm] ${line}`);
    this.lines.update((lines) => [...lines, line]);
  }

  protected json(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private async start(check: string): Promise<void> {
    this.note(`start ${check}`);
    try {
      const steps: Record<string, () => Promise<void>> = {
        camera: () => this.checkCamera(),
        microphone: () => this.checkMicrophone(),
        calendar: () => this.checkCalendar(),
        location: () => this.checkLocation(),
        photos: () => this.checkPhotos(),
        picker: () => this.checkPicker(),
        capture: () => this.checkCapture(),
        'photos-cleanup': () => this.cleanUpPhoto(),
        tracking: () => this.checkTracking(),
        notifications: () => this.checkNotifications(),
        status: () => this.checkStatus(),
      };
      const step = steps[check];
      if (!step) throw new Error(`no check named ${check}`);
      await step();
      this.note(`done ${check}`);
    } catch (error) {
      this.note(`FAILED ${check}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async until(what: string, ready: () => boolean | Promise<boolean>, ms = 60000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ready()) return;
      await wait(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  private async checkCamera(): Promise<void> {
    const module = host('NgNativeCamera')!;
    await this.cameraAccess.check();
    this.note(`camera permission ${this.cameraAccess.status()}`);
    this.note(`camera available ${this.json(await module['isAvailableAsync']!())}`);
    this.note(`camera permission ask ${await this.cameraAccess.ensure()}`);
    this.note(`camera permission ${this.cameraAccess.status()}`);
    this.cameraShown.set('picture');
    await wait(2500);
    const picture = await this.camera()?.takePicture({ quality: 0.7 });
    this.note(`picture ${picture?.uri} ${picture?.width}x${picture?.height}`);
    await this.takePng();
    await wait(1500);
    this.cameraShown.set('muted');
    await wait(1500);
    const muted = this.camera()?.record({ maxDuration: 3 });
    const mutedMovie = await muted;
    this.note(`movie muted ${mutedMovie?.uri}`);
    await this.microphone.check();
    this.note(`microphone ${this.microphone.status()}`);
    this.note(`microphone ask ${await this.microphone.ensure()} (${this.microphone.status()})`);
    this.cameraShown.set('sound');
    await wait(1500);
    const sound = await this.camera()?.record({ maxDuration: 3 });
    this.note(`movie sound ${sound?.uri}`);
    await wait(1000);
    this.note('camera shown, waiting for a shot');
    await wait(4000);
  }

  private async checkMicrophone(): Promise<void> {
    await this.recording.check();
    this.note(`microphone ${this.recording.status()}`);
    this.note(`microphone ask ${await this.recording.ensure()} (${this.recording.status()})`);
    const recorder = this.recorder.native;
    await recorder.prepareToRecordAsync();
    recorder.record();
    this.note('recording');
    await wait(3000);
    await recorder.stop();
    this.note(`recorded ${recorder.uri} ${this.json(recorder.getStatus())}`);
    const player = runInInjectionContext(this.injector, () => audioPlayer(recorder.uri!));
    await wait(500);
    player.native.play();
    await wait(1000);
    this.note(
      `playing ${player.native.playing} at ${player.native.currentTime.toFixed(2)}s of ${player.native.duration.toFixed(2)}s`,
    );
    await wait(3000);
    this.note(`after ${player.native.currentTime.toFixed(2)}s playing ${player.native.playing}`);
    player.native.remove?.();
  }

  private async checkCalendar(): Promise<void> {
    const calendar = this.calendar;
    this.note(
      `calendar permission ask ${await calendar.permission.request()} (${calendar.permission.status()})`,
    );
    this.note(
      `reminders permission ask ${await calendar.remindersPermission.request()} (${calendar.remindersPermission.status()})`,
    );
    this.note(
      `calendars ${(await calendar.calendars()).length}, reminder lists ${(await calendar.calendars(EntityTypes.REMINDER)).length}, sources ${calendar.sources().length}`,
    );
    const stamp = Date.now();
    const title = `ngn-perm-test ${stamp}`;
    const created = await calendar.createCalendar({
      title,
      color: '#FF6600',
      entityType: 'event',
    } as never);
    if (!created) throw new Error('no calendar created');
    this.note(`created calendar ${created.title} ${created.id}`);
    try {
      const start = new Date(stamp + 3600_000);
      const end = new Date(stamp + 7200_000);
      const event = await created.createEvent({
        title: 'perm event',
        startDate: start,
        endDate: end,
        notes: 'test',
      });
      this.note(`created event ${event.id} ${event.title}`);
      await event.update({ title: 'perm event edited', location: 'Desk' });
      const read = await calendar.event(event.id);
      this.note(`read event ${read?.title} at ${read?.location}`);
      const listed = await calendar.events([created], new Date(stamp), new Date(stamp + 86400_000));
      this.note(`listed ${listed.map((each) => each.title).join(', ')}`);
      await event.delete();
      this.note(`deleted event, read now ${this.json(await calendar.event(event.id))}`);
    } finally {
      await created.delete();
      this.note(`deleted calendar, read now ${this.json(await calendar.calendar(created.id))}`);
    }
    const list = await calendar.createCalendar({
      title: `${title} reminders`,
      color: '#0066FF',
      entityType: 'reminder',
    } as never);
    if (!list) throw new Error('no reminder list created');
    this.note(`created reminder list ${list.title} ${list.id}`);
    try {
      const reminder = await list.createReminder({
        title: 'perm reminder',
        dueDate: new Date(stamp + 86400_000),
      });
      this.note(`created reminder ${reminder.id} ${reminder.title}`);
      await reminder.update({ title: 'perm reminder edited', completed: true });
      const read = await calendar.reminder(reminder.id!);
      this.note(`read reminder ${read?.title} completed ${read?.completed}`);
      await reminder.delete();
      this.note(`deleted reminder, read now ${this.json(await calendar.reminder(reminder.id!))}`);
    } finally {
      await list.delete();
      this.note(`deleted reminder list, read now ${this.json(await calendar.calendar(list.id))}`);
    }
  }

  private async checkLocation(): Promise<void> {
    const location = this.location;
    this.note(
      `location permission ${await location.permission.check()} (${location.permission.status()})`,
    );
    const fix = await location.current('balanced');
    this.note(`current ${fix ? 'a fix' : 'null'} (${location.permission.status()})`);
    if (fix)
      this.mapCamera.set({
        coordinates: { latitude: fix.latitude, longitude: fix.longitude },
        zoom: 14,
      });
    this.mapShown.set(true);
    const stop = await location.start({ accuracy: 'high' });
    this.note('watching');
    await wait(8000);
    stop();
    this.note('stopped');
    const count = this.lines().length;
    await wait(6000);
    const after = this.lines()
      .slice(count)
      .filter((line) => line.startsWith('position'));
    this.note(`fixes after stop ${after.length}`);
  }

  private async checkPhotos(): Promise<void> {
    const media = this.media;
    this.note(
      `photos permission ask ${await media.requestPermission()} (${media.permission.status()})`,
    );
    this.note(`query ${(await media.assets((query) => query.limit(3))).length} assets`);
    const uri = this.file();
    if (!uri) throw new Error('no file to save');
    const saved = await media.save(uri);
    if (!saved) throw new Error('nothing saved');
    this.note(`saved asset ${saved.id}`);
    const made: Album[] = [];
    try {
      const album = await this.attempt('album with the asset', () =>
        media.createAlbum('ngn-perm-test', [saved]),
      );
      if (album) made.push(album);
      const empty = await this.attempt('empty album', () =>
        media.createAlbum('ngn-perm-test-empty', []),
      );
      if (empty) {
        made.push(empty);
        const into = await this.attempt('save into the album', () => media.save(uri, empty));
        this.note(`saved into album ${into?.id}`);
        if (into) await this.attempt('delete that asset', () => media.deleteAssets([into]));
      }
      for (const each of made) {
        this.note(
          `album ${await each.getTitle()} holds ${(await media.assets((query) => query.album(each))).length}`,
        );
      }
    } finally {
      await this.attempt('delete the asset', () => media.deleteAssets([saved]));
      if (made.length) await this.attempt('delete the albums', () => media.deleteAlbums(made));
      this.note(
        `after: ${(await media.assets()).length} assets, test albums ${(await media.albums()).length}`,
      );
    }
  }

  /** Deletes the asset whose id `file` names: one an earlier run saved and did not delete. */
  private async cleanUpPhoto(): Promise<void> {
    const asset = this.media.asset(this.file());
    if (asset)
      await this.attempt('delete the leftover asset', () => this.media.deleteAssets([asset]));
    this.note(`after: ${(await this.media.assets()).length} assets`);
  }

  /** Each permission as it stands, asking for none: what a reset should leave undetermined. */
  private async checkStatus(): Promise<void> {
    const status = async (name: string, method: string) =>
      this.note(
        `${name} ${((await host(name)?.[method]?.()) as { status?: string } | undefined)?.status}`,
      );
    await status('NgNativeCamera', 'getCameraPermissionsAsync');
    await status('NgNativeAudio', 'getRecordingPermissionsAsync');
    await status('NgNativeCalendar', 'getCalendarPermissionsAsync');
    await status('NgNativeCalendar', 'getRemindersPermissionsAsync');
    await status('NgNativeLocation', 'getForegroundPermissionsAsync');
    await status('NgNativeMediaLibrary', 'getPermissionsAsync');
    await status('NgNativeTrackingTransparency', 'getTrackingPermissionsAsync');
    await status('NgNativeNotifications', 'getPermissionsAsync');
  }

  private async attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
    try {
      const value = await run();
      this.note(`${what}: ok`);
      return value;
    } catch (error) {
      this.note(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async checkPicker(): Promise<void> {
    this.note(
      `test albums left: ${(await this.media.album('ngn-perm-test')) ?? 'none'}, ${(await this.media.album('ngn-perm-test-empty')) ?? 'none'}`,
    );
    const picked = await this.picker.pick({ mediaTypes: ['images'] });
    this.note(`picked ${picked.length} ${picked.map((each) => each.uri).join(', ')}`);
  }

  private async takePng(): Promise<void> {
    const png = await this.camera()?.takePicture({ imageType: 'png' });
    this.note(`picture png ${png?.uri} ${png?.width}x${png?.height} ${png?.format}`);
  }

  private async checkCapture(): Promise<void> {
    this.note(`camera permission ask ${await this.picker.cameraPermission.ensure()}`);
    this.note('camera sheet shown, waiting for a shot');
    const [photo] = await this.picker.capture({ quality: 0.8, exif: true });
    this.note(
      photo
        ? `captured ${photo.uri} ${photo.width}x${photo.height} ${photo.mimeType} ${photo.fileSize} bytes, fileName ${photo.fileName}, exif ${Object.keys(photo.exif ?? {}).length} keys`
        : 'captured nothing',
    );
    this.note(`videos only ${(await this.picker.capture({ mediaTypes: 'videos' })).length}`);
  }

  private async checkTracking(): Promise<void> {
    this.note(`tracking available ${this.tracking.available()}`);
    this.note(
      `tracking ask ${await this.tracking.permission.request()} (${this.tracking.permission.status()})`,
    );
    this.note(`advertising id ${this.tracking.advertisingId()}`);
    await wait(4000);
    this.note(
      `tracking ask again ${await this.tracking.permission.request()} (${this.tracking.permission.status()})`,
    );
    this.note(`advertising id ${this.tracking.advertisingId()}`);
  }

  private async checkNotifications(): Promise<void> {
    const notifications = this.notifications;
    this.note(`notifications ask ${await notifications.requestPermission()}`);
    notifications.setBadge(7);
    await wait(300);
    this.note(`badge ${await notifications.badge()}`);
    const id = await notifications.schedule({
      content: { title: 'ngn perm test', body: 'Click me', badge: 3 },
      trigger: { type: 'timeInterval', seconds: 2 } as never,
    });
    this.note(`scheduled ${id}`);
    try {
      await this.until(
        'the notification',
        () => notifications.latest()?.request.identifier === id,
        15000,
      );
      this.note(`badge after delivery ${await notifications.badge()}`);
      await this.until(
        'a click on it',
        () => notifications.response()?.notification.request.identifier === id,
        90000,
      );
    } finally {
      notifications.setBadge(0);
      await wait(300);
      this.note(`badge cleared ${await notifications.badge()}`);
      if (id) await notifications.dismiss(id);
    }
  }
}
