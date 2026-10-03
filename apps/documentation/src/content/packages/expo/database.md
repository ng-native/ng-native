---
title: Database
summary: A SQLite database, opened on first use, migrated before the first query sees it.
---

# Database

`database(name, migrations)` replaces `SQLiteProvider` and `useSQLiteContext` - the documented way
into `expo-sqlite`, and both React. The database itself is a plain object with `getAllAsync` and
the rest already on it, so what this rebuilds is the lifecycle: opened once, migrated before
anything queries it, closed on request.

## Install

```sh
npx expo install expo-sqlite
```

```ts
import { database } from '@ng-native/expo/database';
```

## The smallest useful example

A value rather than a service, because a schema belongs to a feature rather than to an injector,
and an app usually has exactly one:

```ts
import { database } from '@ng-native/expo/database';

export const notes = database('notes.db', [
  { to: 1, up: (db) => db.execAsync('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT)') },
]);
```

```ts
import { Component, OnInit, signal } from '@angular/core';
import { Text } from '@ng-native/components';
import { notes } from './notes-db.ts';

@Component({
  selector: 'app-note-list',
  imports: [Text],
  template: `<text>{{ count() }} notes</text>`,
})
export class NoteList implements OnInit {
  protected readonly count = signal(0);

  async ngOnInit(): Promise<void> {
    const db = await notes.ready();
    const rows = await db.getAllAsync('SELECT * FROM note');
    this.count.set(rows.length);
  }
}
```

`count` is a signal: assigning a plain property after an asynchronous operation does not itself
schedule a render in a zoneless app, so `signal(0)` and `count.set(...)` are what get the row count
onto the screen once it arrives.

## Opening

Opening is deferred until something calls `ready()`: a database opened at startup is a file handle
and a WAL journal for an app that may never read from it. `ready()` is safe to call from every
caller that wants the database - the first one pays for opening it, and everyone who arrives while
it is still opening is handed that same promise, which is what stops two connections to one file
being made at once.

## Migrations

Each migration names the version it produces (`to`) and a function that gets there (`up`). They
run in order, each inside its own transaction, and the current version is recorded in SQLite's own
`PRAGMA user_version` - not a table this has to create first. A migration whose `to` is at or
below the version already recorded is skipped, so `database()` can be called with the same
migration list on every launch and only the new ones run.

```ts
export const notes = database('notes.db', [
  { to: 1, up: (db) => db.execAsync('CREATE TABLE note (id, body)') },
  { to: 2, up: (db) => db.execAsync('ALTER TABLE note ADD COLUMN created_at INTEGER') },
]);
```

`PRAGMA user_version` is set inside the same transaction as the migration it records. SQLite
treats `user_version` transactionally, so the schema change and the version bump commit together
or roll back together: a migration that fails part-way leaves both the schema and the recorded
version as they were, and the next launch runs it again from the start.

### When a migration fails

`ready()` rejects with the migration's own error, and the connection it opened is closed before the
rejection arrives, so nothing is left holding the file. The failed open is then forgotten: the next
call to `ready()` opens the database and tries the outstanding migrations again. `close()` after a
failed open resolves without doing anything, since there is no connection left to release.

## Foreign keys and other connection settings

SQLite enforces a foreign key only on a connection that has asked it to, with
`PRAGMA foreign_keys = ON`, and ignores that statement inside a transaction. A migration runs in
one, and once, so it is the wrong place for it twice over. `onOpen` runs on every open, before the
migrations and outside any transaction:

```ts
const db = database('app.db', migrations, {
  onOpen: (db) => db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;'),
});
```

Without it a schema's `REFERENCES ... ON DELETE CASCADE` is declared and not enforced, with no
error. If `onOpen` throws, the connection is closed and `ready()` rejects with its error.

## Closing

`close()` releases the database connection, and resolves even if opening it had failed. It does
not delete stored data. The next call to
`ready()` reopens the database; most apps can leave the connection open. To remove data on
sign-out, delete the rows or the database file explicitly - closing the connection is not that.

## Without the module

`ready()` rejects with a `MissingModuleError` when `expo-sqlite` is missing - never installed, or
installed without the app being rebuilt since - on iOS, Android and the web alike. Its message
names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed). There
is no value to fall back to for a query that has not been asked yet, so a database an app relies
on fails loudly rather than pretending to hold data it does not have.

## Working offline

`Database` is the cache to reach for a list - a feed, search results, anything queried, filtered or
sorted, where `Storage`'s single-value model does not fit. [Working offline](/guide/offline) works
through a full example: caching a feed here, refreshing it when [`Network`](/packages/expo/network)
says there is a connection, and queuing writes made offline in a table of their own.
