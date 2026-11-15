// The file-backed key-value store behind @react-native-async-storage: one JSON file per database
// in the app's data directory, written whole and atomically after each change. Any thread.
#pragma once

#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class KeyValueStore {
 public:
  explicit KeyValueStore(std::string directory);

  std::vector<std::optional<std::string>> get(const std::string &db, const std::vector<std::string> &keys);
  // A null value removes its key. False when the file could not be written.
  bool set(const std::string &db, const std::vector<std::pair<std::string, std::optional<std::string>>> &values);
  // Merges each value into the stored one as JSON objects, recursively; a value that is not an
  // object, or a key with nothing stored, is set as it is.
  bool merge(const std::string &db, const std::vector<std::pair<std::string, std::string>> &values);
  bool remove(const std::string &db, const std::vector<std::string> &keys);
  std::vector<std::string> keys(const std::string &db);
  bool clear(const std::string &db);

  // The database 2.x and 3.x's legacy calls share.
  static constexpr const char *kLegacy = "RCTAsyncLocalStorage";

 private:
  std::map<std::string, std::string> &load(const std::string &db);
  bool save(const std::string &db);
  std::string path(const std::string &db) const;

  std::string directory_;
  std::mutex mutex_;
  std::map<std::string, std::map<std::string, std::string>> dbs_;
};

} // namespace ngn
