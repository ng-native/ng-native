// NgNativeSqlite: expo-sqlite's databases over the system's sqlite3, for @ng-native/expo's
// `database()` on a desktop OS. A TurboModule cannot hand JavaScript an object with methods, so a
// database is a handle: `openDatabaseAsync` answers `{id, databasePath, databaseName}`, and every
// other call takes the id first. The desktop loader builds expo-sqlite's SQLiteDatabase over it
// (withTransactionAsync is BEGIN, the task, then COMMIT or ROLLBACK, through execAsync).
//
// - openDatabaseAsync / openDatabaseSync (name, options?, directory?): `:memory:` is in memory, a
//   name is a file in `directory`, or in defaultDatabaseDirectory, made when missing. A file
//   database uses the WAL journal, as expo-sqlite's does.
// - execAsync / execSync (id, source): one or more statements, results dropped.
// - runAsync / runSync (id, source, params?): one statement, answering {lastInsertRowId, changes}.
// - getFirstAsync / getFirstSync and getAllAsync / getAllSync (id, source, params?): the rows as
//   objects keyed by column name, or the first one, or null.
// - isInTransactionAsync / isInTransactionSync (id), closeAsync / closeSync (id).
// - deleteDatabaseAsync / deleteDatabaseSync (name, directory?): refused while it is open.
//
// A database file opens, is made or is deleted only where `files` lets the app write
// (FileAccess::writeFor): its own folders, the user's picks and the paths its capabilities declare
// readwrite. Anywhere else, `directory` included, is refused in the same words whether or not a
// file is there.
//
// Params are an array for `?` and `?NNN`, or an object whose keys are the names as written in the
// SQL (`$id`, `:id`, `@id`). A boolean binds as 0 or 1, and bytes as {base64}, which is also how a
// blob column comes back. Every call runs on the JavaScript thread, in the order it was made.
// Closing the module (a reload) closes every database it opened.
#pragma once

#include "ngn/file-system.h"
#include "ngn/native-module.h"

#include <memory>
#include <string>

namespace ngn {

std::shared_ptr<NativeModule> makeSqliteModule(std::string defaultDatabaseDirectory, std::shared_ptr<FileAccess> files);

} // namespace ngn
