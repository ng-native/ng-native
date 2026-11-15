#import "bookmarks.h"

#import <Foundation/Foundation.h>

#include <map>
#include <mutex>

namespace ngn::appkit {

namespace {

NSData *dataOf(const std::string &bytes) {
  return [NSData dataWithBytes:bytes.data() length:bytes.size()];
}

std::string bytesOf(NSData *data) {
  return std::string(static_cast<const char *>(data.bytes), data.length);
}

// A bookmark resolved, with the security scope where it has one (a sandboxed app's are always
// scoped; an app outside the sandbox may hold a plain one).
NSURL *resolveURL(NSData *data, BOOL *stale) {
  NSURL *url = [NSURL URLByResolvingBookmarkData:data
                                         options:NSURLBookmarkResolutionWithSecurityScope | NSURLBookmarkResolutionWithoutUI
                                   relativeToURL:nil
                             bookmarkDataIsStale:stale
                                           error:nil];
  if (url == nil) {
    url = [NSURL URLByResolvingBookmarkData:data
                                    options:NSURLBookmarkResolutionWithoutUI
                              relativeToURL:nil
                        bookmarkDataIsStale:stale
                                      error:nil];
  }
  return url;
}

class SecurityScopedBookmarks final : public Bookmarks {
 public:
  std::optional<std::string> make(const std::string &path) override {
    @autoreleasepool {
      NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
      NSData *data = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
                   includingResourceValuesForKeys:nil
                                    relativeToURL:nil
                                            error:nil];
      if (data == nil) {
        data = [url bookmarkDataWithOptions:0 includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
      }
      return data != nil ? std::optional<std::string>(bytesOf(data)) : std::nullopt;
    }
  }

  std::optional<Resolved> resolve(const std::string &bookmark) override {
    @autoreleasepool {
      BOOL stale = NO;
      NSURL *url = resolveURL(dataOf(bookmark), &stale);
      if (url == nil || url.path == nil) {
        return std::nullopt;
      }
      // The file's own path, links already followed; Foundation's URLByResolvingSymlinksInPath
      // would strip /private from /private/var, where the core compares the real path.
      return Resolved{.path = url.path.UTF8String, .stale = static_cast<bool>(stale)};
    }
  }

  bool startAccess(const std::string &bookmark) override {
    std::lock_guard lock(mutex_);
    auto &open = open_[bookmark];
    if (open.url == nil) {
      BOOL stale = NO;
      open.url = resolveURL(dataOf(bookmark), &stale);
    }
    if (open.url == nil || ![open.url startAccessingSecurityScopedResource]) {
      if (open.count == 0) {
        open_.erase(bookmark);
      }
      return false;
    }
    open.count++;
    return true;
  }

  void stopAccess(const std::string &bookmark) override {
    std::lock_guard lock(mutex_);
    auto it = open_.find(bookmark);
    if (it == open_.end()) {
      return;
    }
    [it->second.url stopAccessingSecurityScopedResource];
    if (--it->second.count <= 0) {
      open_.erase(it);
    }
  }

 private:
  struct Open {
    NSURL *url;
    int count{0};
  };
  std::mutex mutex_;
  std::map<std::string, Open> open_;
};

} // namespace

std::shared_ptr<Bookmarks> makeBookmarks() {
  return std::make_shared<SecurityScopedBookmarks>();
}

PickStore::Persistence pickPersistence(const std::string &key) {
  NSString *name = [NSString stringWithUTF8String:key.c_str()];
  return {
      .load = [name]() -> std::optional<std::string> {
        NSString *text = [NSUserDefaults.standardUserDefaults stringForKey:name];
        return text != nil ? std::optional<std::string>(text.UTF8String) : std::nullopt;
      },
      .save = [name](const std::string &json) {
        [NSUserDefaults.standardUserDefaults setObject:[NSString stringWithUTF8String:json.c_str()] forKey:name];
      },
  };
}

} // namespace ngn::appkit
