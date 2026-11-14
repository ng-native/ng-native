/**
 * `Calendar`, bound to `expo-calendar`: the calendars on the device, and the events and reminders
 * in them.
 *
 * ```ts
 * import { Calendar } from '@ng-native/expo/calendar';
 *
 * private readonly calendar = inject(Calendar);
 *
 * async thisWeek(): Promise<ExpoCalendarEvent[]> {
 *   if (!(await this.calendar.permission.ensure())) return [];
 *   const calendars = await this.calendar.calendars();
 *   const start = new Date();
 *   const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
 *   return this.calendar.events(calendars, start, end);
 * }
 *
 * async book(calendar: ExpoCalendar): Promise<void> {
 *   await calendar.createEvent({ title: 'Padel', startDate, endDate, alarms: [{ relativeOffset: -30 }] });
 * }
 * ```
 *
 * This is the module's object API: a calendar, an event, a reminder and an attendee are handles
 * with their own `update()` and `delete()`, and a calendar makes its own events and reminders. The
 * service is where the handles are reached from, so a test can provide them, and where the
 * permissions are: full access to the calendars, the write-only access iOS 17 added for an app
 * that only adds events, and on iOS and macOS the reminders.
 *
 * What exists on Apple's OSes alone - the default calendar, the sources and the reminders, and on
 * iOS the calendar picker - answers null, nothing or refused on Android rather than throwing, so
 * code shared by both runs on both. Without the module installed, every list answers empty, every lookup null,
 * and the permissions are refused.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import type {
  Availability as ExpoAvailability,
  EntityTypes as ExpoEntityTypes,
  ExpoCalendar,
  ExpoCalendarEvent,
  ExpoCalendarReminder,
  Frequency as ExpoFrequency,
  Source,
} from 'expo-calendar';
import { currentPlatform, expoModule, isApple, type ModulePlatform, presence } from './native.ts';
import { Permission, UNAVAILABLE } from './permissions.ts';

type Expo = typeof import('expo-calendar');

/** The module's functions and classes this service calls. A test provides fakes of each. */
export type NativeCalendar = Pick<
  Expo,
  | 'getCalendarPermissions'
  | 'requestCalendarPermissions'
  | 'getRemindersPermissions'
  | 'requestRemindersPermissions'
  | 'getCalendars'
  | 'getDefaultCalendarSync'
  | 'createCalendar'
  | 'presentPicker'
  | 'listEvents'
  | 'getSourcesSync'
  | 'ExpoCalendar'
  | 'ExpoCalendarEvent'
  | 'ExpoCalendarReminder'
>;

type Args<K extends keyof NativeCalendar> = NativeCalendar[K] extends (...args: infer A) => unknown
  ? A
  : never;

/**
 * What a calendar holds, as `expo-calendar`'s own enum. Importing the enum from the module loads
 * the module, which a test in Node cannot; these are the same strings, typed as the enum.
 */
export const EntityTypes = {
  EVENT: 'event',
  REMINDER: 'reminder',
} as unknown as typeof ExpoEntityTypes;

/** How often a recurrence rule repeats, as the module's own enum. */
export const Frequency = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as unknown as typeof ExpoFrequency;

/** Whether an event shows its time as taken, as the module's own enum. */
export const Availability = {
  NOT_SUPPORTED: 'notSupported',
  BUSY: 'busy',
  FREE: 'free',
  TENTATIVE: 'tentative',
  UNAVAILABLE: 'unavailable',
} as unknown as typeof ExpoAvailability;

@Service()
export class Calendar {
  /** Overridden in a test to read calendars that are not there. */
  static readonly SOURCE = new InjectionToken<NativeCalendar | null>(
    'angular-native.calendarSource',
    { factory: () => expoModule('expo-calendar', () => require('expo-calendar') as Expo) },
  );

  /** Overridden in a test to be on iOS or macOS, where the calls only Apple's OSes have can be made. */
  static readonly PLATFORM = new InjectionToken<ModulePlatform | null>(
    'angular-native.calendarPlatform',
    { factory: currentPlatform },
  );

  private readonly native = inject(Calendar.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);
  private readonly platform = inject(Calendar.PLATFORM);

  /** Full access: reading the calendars and their events, as well as adding to them. */
  readonly permission: Permission = this.calendarPermission(false);

  /**
   * Write-only access, on iOS 17 and later: enough to add events, and nothing to read. Elsewhere
   * the same as {@link permission}.
   */
  readonly writePermission: Permission = this.calendarPermission(true);

  /** The reminders, on iOS and macOS. Refused on Android, which keeps none in its calendars. */
  readonly remindersPermission: Permission = Permission.of(
    () => (this.apple() ? this.native!.getRemindersPermissions() : Promise.resolve(UNAVAILABLE)),
    () =>
      this.apple() ? this.native!.requestRemindersPermissions() : Promise.resolve(UNAVAILABLE),
  );

  /**
   * The calendars on the device, of events unless {@link EntityTypes.REMINDER} is asked for. The
   * module itself lists both kinds when given none, and on iOS refuses that without reminders access.
   */
  async calendars(entityType: ExpoEntityTypes = EntityTypes.EVENT): Promise<ExpoCalendar[]> {
    return (await this.native?.getCalendars(entityType)) ?? [];
  }

  /** The calendar with this id, or null. */
  async calendar(id: string): Promise<ExpoCalendar | null> {
    return (await this.native?.ExpoCalendar.get(id)) ?? null;
  }

  /** The calendar new events go in unless another is chosen, on iOS and macOS. Null on Android. */
  defaultCalendar(): ExpoCalendar | null {
    return this.apple() ? this.native!.getDefaultCalendarSync() : null;
  }

  /** A new calendar, with the module's own details: `title`, `color`, `entityType` and the rest. */
  async createCalendar(...details: Args<'createCalendar'>): Promise<ExpoCalendar | null> {
    return (await this.native?.createCalendar(...details)) ?? null;
  }

  /**
   * On iOS, the system's calendar picker. Null if the user cancels it, and elsewhere: EventKitUI is
   * iOS only.
   */
  async pickCalendar(): Promise<ExpoCalendar | null> {
    return this.native !== null && this.platform === 'ios' ? this.native.presentPicker() : null;
  }

  /**
   * The events from `start` to `end` in the calendars given, as handles or their ids, each
   * occurrence of a recurring event as an event of its own. An event that overlaps the range at
   * all is in it, one running across either end included.
   */
  async events(
    calendars: readonly (string | ExpoCalendar)[],
    start: Date,
    end: Date,
  ): Promise<ExpoCalendarEvent[]> {
    if (!this.native || calendars.length === 0) return [];
    return this.native.listEvents([...calendars], start, end);
  }

  /** The event with this id, such as one kept from an earlier list, or null. */
  async event(id: string): Promise<ExpoCalendarEvent | null> {
    return (await this.native?.ExpoCalendarEvent.get(id)) ?? null;
  }

  /** The reminder with this id, on iOS and macOS, or null. */
  async reminder(id: string): Promise<ExpoCalendarReminder | null> {
    return this.apple() ? this.native!.ExpoCalendarReminder.get(id) : null;
  }

  /** The accounts the calendars belong to, on iOS and macOS: iCloud, Exchange, a subscription. */
  sources(): Source[] {
    return this.apple() ? this.native!.getSourcesSync() : [];
  }

  private calendarPermission(writeOnly: boolean): Permission {
    return Permission.of(
      () => this.native?.getCalendarPermissions(writeOnly) ?? Promise.resolve(UNAVAILABLE),
      () => this.native?.requestCalendarPermissions(writeOnly) ?? Promise.resolve(UNAVAILABLE),
    );
  }

  /** The module is here and the app is on an Apple OS, where the calls EventKit has exist. */
  private apple(): boolean {
    return this.native !== null && isApple(this.platform);
  }
}
