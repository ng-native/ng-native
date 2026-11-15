// The OS half of NgNativeFileSystem: FSEvents streams with file-level events, one per watch, each
// on its own serial queue, and the folders NSFileManager names.
#import "file-system.h"
#import "test-launch.h"

#import <CoreServices/CoreServices.h>
#import <Foundation/Foundation.h>

#include <climits>
#include <cstdlib>
#include <map>
#include <mutex>

namespace ngn::appkit {

namespace {

std::string str(NSString *s) {
  return s != nil ? std::string(s.UTF8String) : std::string{};
}

// The path with every link followed (/var is /private/var), as FSEvents reports paths, and with
// no trailing slash. Foundation's own resolving strips /private, so this is realpath's.
std::string plain(NSString *path) {
  char resolved[PATH_MAX];
  if (realpath(path.fileSystemRepresentation, resolved) != nullptr) {
    return resolved;
  }
  return str([path hasSuffix:@"/"] && path.length > 1 ? [path substringToIndex:path.length - 1] : path);
}

struct Stream {
  FSEventStreamRef stream{nullptr};
  dispatch_queue_t queue{nil};
  std::function<void(std::vector<FileWatcher::Event>)> events;
};

void callback(ConstFSEventStreamRef, void *info, size_t count, void *paths, const FSEventStreamEventFlags flags[],
              const FSEventStreamEventId[]) {
  auto *stream = static_cast<Stream *>(info);
  auto **names = static_cast<char **>(paths);
  std::vector<FileWatcher::Event> batch;
  for (size_t i = 0; i < count; i++) {
    batch.push_back({
        .path = names[i],
        .created = (flags[i] & kFSEventStreamEventFlagItemCreated) != 0,
        .removed = (flags[i] & kFSEventStreamEventFlagItemRemoved) != 0,
        .renamed = (flags[i] & kFSEventStreamEventFlagItemRenamed) != 0,
        .modified = (flags[i] & (kFSEventStreamEventFlagItemModified | kFSEventStreamEventFlagItemInodeMetaMod)) != 0,
    });
  }
  stream->events(std::move(batch));
}

class FSEventsWatcher final : public FileWatcher {
 public:
  int start(const std::string &path, std::function<void(std::vector<Event>)> events) override {
    // A file is watched through its folder; the core keeps only the file's own events.
    BOOL folder = NO;
    NSString *at = [NSString stringWithUTF8String:path.c_str()];
    [NSFileManager.defaultManager fileExistsAtPath:at isDirectory:&folder];
    NSString *watched = folder ? at : at.stringByDeletingLastPathComponent;

    auto stream = std::make_unique<Stream>();
    stream->events = std::move(events);
    stream->queue = dispatch_queue_create("ngn.file-watch", DISPATCH_QUEUE_SERIAL);
    FSEventStreamContext context{.version = 0, .info = stream.get()};
    CFArrayRef paths = (__bridge CFArrayRef) @[ watched ];
    stream->stream = FSEventStreamCreate(
        nullptr, callback, &context, paths, kFSEventStreamEventIdSinceNow, 0.1,
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot);
    FSEventStreamSetDispatchQueue(stream->stream, stream->queue);
    FSEventStreamStart(stream->stream);
    std::lock_guard lock(mutex_);
    int handle = ++next_;
    streams_[handle] = std::move(stream);
    return handle;
  }

  void stop(int handle) override {
    std::unique_ptr<Stream> stream;
    {
      std::lock_guard lock(mutex_);
      auto it = streams_.find(handle);
      if (it == streams_.end()) {
        return;
      }
      stream = std::move(it->second);
      streams_.erase(it);
    }
    // On its own queue, so no callback is running or follows once this returns.
    FSEventStreamRef ref = stream->stream;
    dispatch_sync(stream->queue, ^{
      FSEventStreamStop(ref);
      FSEventStreamInvalidate(ref);
      FSEventStreamRelease(ref);
    });
  }

 private:
  std::mutex mutex_;
  std::map<int, std::unique_ptr<Stream>> streams_;
  int next_{0};
};

} // namespace

std::shared_ptr<FileWatcher> makeFileWatcher() {
  return std::make_shared<FSEventsWatcher>();
}

FileAccess::Folders fileFolders(const std::string &appData, const std::string &cache) {
  NSFileManager *files = NSFileManager.defaultManager;
  auto user = [files](NSSearchPathDirectory directory) {
    NSURL *url = [files URLsForDirectory:directory inDomains:NSUserDomainMask].firstObject;
    return url != nil ? plain(url.path) : std::string{};
  };
  NSString *documents = [[NSString stringWithUTF8String:appData.c_str()] stringByAppendingPathComponent:@"Documents"];
  [files createDirectoryAtPath:documents withIntermediateDirectories:YES attributes:nil error:nil];
  return {
      .cache = plain([NSString stringWithUTF8String:cache.c_str()]),
      .document = plain(documents),
      .appData = plain([NSString stringWithUTF8String:appData.c_str()]),
      .temp = testLaunch() ? plain([NSString stringWithUTF8String:testLaunch()->temp().c_str()]) : plain(NSTemporaryDirectory()),
      .home = plain(NSHomeDirectory()),
      .desktop = user(NSDesktopDirectory),
      .downloads = user(NSDownloadsDirectory),
  };
}

} // namespace ngn::appkit
