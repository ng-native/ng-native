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
import { desktopHost } from './desktop-host.ts';

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
    {
      factory: () =>
        expoModule('expo-calendar', () => require('expo-calendar') as Expo, {
          desktop: desktopCalendar,
        }),
    },
  );

  /** Overridden in a test to be on iOS or macOS, where the calls only Apple's OSes have can be made. */
  static readonly PLATFORM = new InjectionToken<ModulePlatform | null>(
    'angular-native.calendarPlatform',
    { factory: currentPlatform },
  );

  private readonly native = inject(Calendar.SOURCE);

  /**
   * Whether the module is here. False where the service is absent, on an OS the module is not for,
   * and every call is inert; false too in a build missing the module, where a call can throw a
   * `MissingModuleError`.
   */
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

/**
 * expo-calendar over the desktop host's `NgNativeCalendar`, which answers plain records: a
 * calendar, an event and a reminder read on macOS carry expo-calendar's fields, and the methods its
 * handles have are added to each (not enumerable, so a record still compares as its fields). A
 * calendar lists its events and reminders and creates them; an event and a reminder update and
 * delete themselves. Dates go to the host as milliseconds. A calendar is created and deleted
 * there, but its own `update()` is not available. Null where the host has no such module.
 */
function desktopCalendar(): NativeCalendar | null {
  const host =
    desktopHost<Record<string, ((...args: unknown[]) => unknown) | undefined>>('NgNativeCalendar');
  if (!host) return null;
  type Row = Record<string, unknown> & { id: string };
  // A host built before a method was added has none: a read answers nothing, and a write rejects.
  const call =
    (name: string) =>
    (...args: unknown[]) =>
      host.module[name]?.(...args);
  const write =
    (name: string) =>
    async (...args: unknown[]): Promise<Row> => {
      const method = host.module[name];
      if (!method) {
        throw new Error(
          `[angular-native] Calendar: this macOS host has no ${name}. Build it again with the current @ng-native/desktop.`,
        );
      }
      return method(...args) as Promise<Row>;
    };
  const methods = <T extends Row | null>(record: T, added: Record<string, unknown>): T => {
    if (record && typeof record === 'object') {
      for (const [name, value] of Object.entries(added)) {
        Object.defineProperty(record, name, { value, enumerable: false, configurable: true });
      }
    }
    return record;
  };
  const changes = (update: string, remove: string) => (record: Row) => ({
    update: async (details: Record<string, unknown>, nullableFields: readonly string[] = []) => {
      Object.assign(record, await write(update)(record.id, wire(details), [...nullableFields]));
    },
    delete: async () => {
      await write(remove)(record.id);
    },
  });
  const eventChanges = changes('updateEventAsync', 'deleteEventAsync');
  const reminderChanges = changes('updateReminderAsync', 'deleteReminderAsync');
  const event = (record: Row | null) => methods(record, record ? eventChanges(record) : {});
  const reminder = (record: Row | null) => methods(record, record ? reminderChanges(record) : {});
  const unavailable = (what: string) => async () => {
    throw new Error(`[angular-native] Calendar.${what} is not available on macOS yet.`);
  };
  const calendar = (record: Row | null) =>
    methods(record, {
      listEvents: async (start: Date | string, end: Date | string) =>
        (((await call('listEventsAsync')([record!.id], ms(start), ms(end))) ?? []) as Row[]).map(
          event,
        ),
      listReminders: async (
        start?: Date | string | null,
        end?: Date | string | null,
        status?: string | null,
      ) =>
        (
          ((await call('listRemindersAsync')(
            [record!.id],
            start == null ? null : ms(start),
            end == null ? null : ms(end),
            status ?? null,
          )) ?? []) as Row[]
        ).map(reminder),
      createEvent: async (details: Record<string, unknown>) =>
        event(await write('createEventAsync')(record!.id, wire(details))),
      createReminder: async (details: Record<string, unknown>) =>
        reminder(await write('createReminderAsync')(record!.id, wire(details))),
      update: unavailable('update on a calendar'),
      delete: async () => {
        await write('deleteCalendarAsync')(record!.id);
      },
    });
  const native: NativeCalendar = {
    getCalendarPermissions: (writeOnly?: boolean) =>
      call('getCalendarPermissionsAsync')(writeOnly ?? false),
    requestCalendarPermissions: (writeOnly?: boolean) =>
      call('requestCalendarPermissionsAsync')(writeOnly ?? false),
    getRemindersPermissions: call('getRemindersPermissionsAsync'),
    requestRemindersPermissions: call('requestRemindersPermissionsAsync'),
    getCalendars: async (entityType?: string) =>
      (((await call('getCalendarsAsync')(entityType ?? 'event')) ?? []) as Row[]).map(calendar),
    getDefaultCalendarSync: () =>
      calendar((call('getDefaultCalendarSync')() as Row | null) ?? null),
    getSourcesSync: () => (call('getSourcesSync')() as Source[] | undefined) ?? [],
    listEvents: async (calendars: readonly (string | { id: string })[], start: Date, end: Date) =>
      (
        ((await call('listEventsAsync')(
          calendars.map((each) => (typeof each === 'string' ? each : each.id)),
          start.getTime(),
          end.getTime(),
        )) ?? []) as Row[]
      ).map(event),
    createCalendar: async (details: Record<string, unknown> = {}) =>
      calendar(await write('createCalendarAsync')(wire(details))),
    presentPicker: async () => null,
    ExpoCalendar: {
      get: async (id: string) =>
        calendar(((await call('getCalendarAsync')(id)) as Row | null) ?? null),
    },
    ExpoCalendarEvent: {
      get: async (id: string) => event(((await call('getEventAsync')(id)) as Row | null) ?? null),
    },
    ExpoCalendarReminder: {
      get: async (id: string) =>
        reminder(((await call('getReminderAsync')(id)) as Row | null) ?? null),
    },
  } as unknown as NativeCalendar;
  return native;
}

/** A date as the host takes it: milliseconds since 1970. */
function ms(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return value;
}

const DATE_FIELDS = new Set(['startDate', 'endDate', 'dueDate', 'completionDate', 'absoluteDate']);

/**
 * expo-calendar's details as the host takes them: dates as milliseconds, in an alarm and a
 * recurrence rule too, and no field left undefined.
 */
function wire(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(details ?? {})) {
    if (value !== undefined) out[name] = wireValue(name, value);
  }
  return out;
}

function wireValue(name: string, value: unknown): unknown {
  if (value === null) return null;
  if (DATE_FIELDS.has(name)) return ms(value);
  if (name === 'alarms' && Array.isArray(value)) {
    return value.map((alarm: Record<string, unknown>) => wire(alarm));
  }
  if (name === 'recurrenceRule' && typeof value === 'object') {
    return wire(value as Record<string, unknown>);
  }
  return value;
}
