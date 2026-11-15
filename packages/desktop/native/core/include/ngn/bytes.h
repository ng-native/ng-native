// Bytes as JavaScript sends and receives them: base64, data held behind blob ids, and UTF-8 text
// that arrives in chunks.
#pragma once

#include <folly/dynamic.h>

#include <functional>
#include <set>

#include <map>
#include <mutex>
#include <optional>
#include <string>

namespace ngn {

std::string base64Encode(const std::string &bytes);
// Nothing when `text` is not base64.
std::optional<std::string> base64Decode(const std::string &text);

// The bytes behind React Native's Blob ids, which JavaScript creates (createFromParts), reads
// (FileReader), sends (Networking, WebSocket) and receives. Any thread.
class BlobStore {
 public:
  std::string store(std::string bytes);
  void put(const std::string &id, std::string bytes);
  void release(const std::string &id);
  // `blob` is JavaScript's {blobId, offset, size}. Nothing when the id is unknown.
  std::optional<std::string> resolve(const folly::dynamic &blob) const;
  size_t count() const;

  // The sockets whose binary messages JavaScript takes as blobs (BlobModule.addWebSocketHandler),
  // and how to send bytes over each: what BlobModule and WebSocketModule share.
  struct Sockets {
    std::mutex mutex;
    std::set<int> ids;
    std::map<int, std::function<void(const std::string &)>> senders;
  };
  Sockets sockets;

 private:
  mutable std::mutex mutex_;
  std::map<std::string, std::string> blobs_;
  uint64_t next_{0};
};

// Turns chunks of UTF-8 into text without splitting a character across two chunks: the bytes of
// a character cut off at the end of one chunk wait for the next.
class Utf8Chunker {
 public:
  std::string push(std::string chunk);
  // What is left at the end, as it is.
  std::string finish();

 private:
  std::string pending_;
};

} // namespace ngn
