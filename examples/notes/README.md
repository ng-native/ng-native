# Notes

An offline-first notes app: write and edit while offline, and every change syncs once there is a
connection again, following the pattern in [Working offline](https://ng-native.com/guide/offline).

| Screen                                    | What it shows                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Notes (`src/app/notes/notes-list.ts`)     | A searchable list, pinned notes first, a sync status pill (synced / pending / offline) and pull to refresh   |
| Note (`src/app/editor/editor.ts`)         | Title and body with a debounced autosave, a keyboard-avoiding layout, a word count and delete with a confirm |
| Settings (`src/app/settings/settings.ts`) | A sync on/off toggle, when the data last synced, and a "clear local data" that empties the database for real |

Notes and the write queue live in SQLite through `database()` (`src/app/data/notes-database.ts`),
with the same shape as the offline guide: a `pending_write` table ordered by `seq`, a note and its
queue entry written in one transaction, a serialised flush, and a merge that keeps a note the
server has not confirmed yet. `src/app/sync/notes.ts` is the engine; the queue also lives in a
signal in memory, so it works with no SQLite at all - Node under the tests, a browser preview -
the same "inert, not broken" contract `Database` itself follows.

There is no real backend: `src/app/api/notes-api.ts` is a small in-process fake, with latency and
an occasional failure, so a flaky connection is something the app actually has to handle rather
than something to imagine. The sync toggle in Settings stands in for the "offline" a demo cannot
otherwise switch on: turn it off, write a note, turn it back on, and watch the queue drain.

On macOS the tabs are the window's sidebar, File > New Note (mod+n) makes a note, a right-click on
a row opens a menu to open or pin it, a row drags out to another app as its text, and type, rows
and padding take a Mac's sizes through the `macos:` variant. `src/app/desktop.test.ts` renders the
app as on macOS.

## Run it

From the repository root, after `pnpm install`:

```sh
cd examples/notes
pnpm start     # press i or a, or scan the QR code with Expo Go
pnpm macos     # the same app on macOS, through the desktop host
pnpm test      # Vitest in Node, no simulator
```

`src/app/app.test.ts` creates a note while offline and watches it sync once the connection comes
back. `src/app/sync/notes.test.ts` covers the sync engine on its own against the fake server:
queued writes surviving a failed flush, flush order, no concurrent flushes, and a merge that keeps
pending local notes. `src/app/data/note.test.ts` covers sorting, search and word count with no
Angular in the picture.
