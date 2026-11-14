#include "ngn/key-value-store.h"

#include <folly/json.h>

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace ngn {

namespace {

void mergeInto(folly::dynamic &into, const folly::dynamic &from) {
  for (const auto &[k, v] : from.items()) {
    if (v.isObject() && into.count(k) && into[k].isObject()) {
      mergeInto(into[k], v);
    } else {
      into[k] = v;
    }
  }
}

std::optional<folly::dynamic> parse(const std::string &json) {
  try {
    return folly::parseJson(json);
  } catch (...) {
    return std::nullopt;
  }
}

} // namespace

KeyValueStore::KeyValueStore(std::string directory) : directory_(std::move(directory)) {}

std::string KeyValueStore::path(const std::string &db) const {
  // A database name becomes a file name: anything but letters, digits, dot, dash and underscore
  // turns into an underscore, so a name cannot leave the directory.
  std::string name;
  for (char c : db) {
    name += std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' || c == '_' ? c : '_';
  }
  if (name.empty() || name[0] == '.') {
    name = "_" + name;
  }
  return directory_ + "/" + name + ".json";
}

std::map<std::string, std::string> &KeyValueStore::load(const std::string &db) {
  auto it = dbs_.find(db);
  if (it != dbs_.end()) {
    return it->second;
  }
  auto &values = dbs_[db];
  std::ifstream in(path(db));
  if (in) {
    std::stringstream text;
    text << in.rdbuf();
    if (auto json = parse(text.str()); json && json->isObject()) {
      for (const auto &[k, v] : json->items()) {
        if (k.isString() && v.isString()) {
          values[k.asString()] = v.asString();
        }
      }
    }
  }
  return values;
}

bool KeyValueStore::save(const std::string &db) {
  folly::dynamic json = folly::dynamic::object();
  for (const auto &[k, v] : dbs_[db]) {
    json[k] = v;
  }
  std::error_code error;
  std::filesystem::create_directories(directory_, error);
  std::string target = path(db);
  std::string temp = target + ".tmp";
  {
    std::ofstream out(temp, std::ios::binary | std::ios::trunc);
    if (!out) {
      return false;
    }
    out << folly::toJson(json);
    if (!out.good()) {
      return false;
    }
  }
  return std::rename(temp.c_str(), target.c_str()) == 0;
}

std::vector<std::optional<std::string>> KeyValueStore::get(const std::string &db, const std::vector<std::string> &keys) {
  std::lock_guard lock(mutex_);
  auto &values = load(db);
  std::vector<std::optional<std::string>> out;
  for (const auto &key : keys) {
    auto it = values.find(key);
    out.push_back(it == values.end() ? std::nullopt : std::optional<std::string>(it->second));
  }
  return out;
}

bool KeyValueStore::set(const std::string &db, const std::vector<std::pair<std::string, std::optional<std::string>>> &values) {
  std::lock_guard lock(mutex_);
  auto &stored = load(db);
  for (const auto &[k, v] : values) {
    if (v) {
      stored[k] = *v;
    } else {
      stored.erase(k);
    }
  }
  return save(db);
}

bool KeyValueStore::merge(const std::string &db, const std::vector<std::pair<std::string, std::string>> &values) {
  std::lock_guard lock(mutex_);
  auto &stored = load(db);
  for (const auto &[k, v] : values) {
    auto it = stored.find(k);
    auto incoming = parse(v);
    auto existing = it == stored.end() ? std::nullopt : parse(it->second);
    if (incoming && existing && incoming->isObject() && existing->isObject()) {
      mergeInto(*existing, *incoming);
      stored[k] = folly::toJson(*existing);
    } else {
      stored[k] = v;
    }
  }
  return save(db);
}

bool KeyValueStore::remove(const std::string &db, const std::vector<std::string> &keys) {
  std::lock_guard lock(mutex_);
  auto &stored = load(db);
  for (const auto &k : keys) {
    stored.erase(k);
  }
  return save(db);
}

std::vector<std::string> KeyValueStore::keys(const std::string &db) {
  std::lock_guard lock(mutex_);
  std::vector<std::string> out;
  for (const auto &[k, _] : load(db)) {
    out.push_back(k);
  }
  return out;
}

bool KeyValueStore::clear(const std::string &db) {
  std::lock_guard lock(mutex_);
  load(db).clear();
  return save(db);
}

} // namespace ngn
