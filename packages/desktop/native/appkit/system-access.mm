#import "system-access.h"

#import <AppKit/AppKit.h>

#include <folly/json.h>
#include <set>
#include <unistd.h>

extern char **environ;

namespace ngn::appkit {

folly::dynamic dynamicFrom(id value) {
  if ([value isKindOfClass:NSString.class]) {
    return std::string([(NSString *)value UTF8String]);
  }
  if ([value isKindOfClass:NSNumber.class]) {
    NSNumber *number = value;
    if (strcmp(number.objCType, @encode(BOOL)) == 0 || strcmp(number.objCType, "c") == 0) {
      return (bool)number.boolValue;
    }
    return number.doubleValue;
  }
  if ([value isKindOfClass:NSArray.class]) {
    folly::dynamic out = folly::dynamic::array();
    for (id item in (NSArray *)value) {
      out.push_back(dynamicFrom(item));
    }
    return out;
  }
  if ([value isKindOfClass:NSDictionary.class]) {
    folly::dynamic out = folly::dynamic::object();
    for (id key in (NSDictionary *)value) {
      if ([key isKindOfClass:NSString.class]) {
        out[std::string([(NSString *)key UTF8String])] = dynamicFrom(((NSDictionary *)value)[key]);
      }
    }
    return out;
  }
  return nullptr;
}

std::optional<PackagedApp> packagedApp() {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSString *file = info[@"NGNBundleFile"];
  if (![file isKindOfClass:NSString.class]) {
    return std::nullopt;
  }
  NSString *path = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:file];
  NSString *module = [info[@"NGNModuleName"] isKindOfClass:NSString.class] ? info[@"NGNModuleName"] : @"main";
  NSString *distribution = [info[@"NGNDistribution"] isKindOfClass:NSString.class] ? info[@"NGNDistribution"] : @"app";
  return PackagedApp{path.UTF8String, module.UTF8String, distribution.UTF8String};
}

namespace {

std::map<std::string, std::string> environment() {
  std::map<std::string, std::string> out;
  for (char **entry = environ; entry != nullptr && *entry != nullptr; entry++) {
    std::string line = *entry;
    auto equals = line.find('=');
    if (equals != std::string::npos) {
      out[line.substr(0, equals)] = line.substr(equals + 1);
    }
  }
  return out;
}

// Whether the Command Line Tools or Xcode are installed: without either, /usr/bin's developer tools
// are stubs that only offer to install them.
bool developerToolsInstalled() {
  NSFileManager *files = NSFileManager.defaultManager;
  return [files fileExistsAtPath:@"/Library/Developer/CommandLineTools/usr/bin"] ||
      [files fileExistsAtPath:@"/Applications/Xcode.app/Contents/Developer"];
}

bool isDeveloperStub(const std::string &path) {
  static const std::set<std::string> tools{"git", "make", "clang", "gcc", "cc", "python3", "pip3", "swift",
                                           "swiftc", "lldb", "svn", "xcodebuild", "ld", "nm", "strip"};
  if (path.rfind("/usr/bin/", 0) != 0 || !tools.contains(path.substr(9))) {
    return false;
  }
  static const bool installed = developerToolsInstalled();
  return !installed;
}

} // namespace

ProcessesSetup processesSetup(const std::string &capabilitiesJson) {
  ProcessesSetup setup;
  setup.environment = environment();
  setup.lookup = {
      .isExecutable = [](const std::string &path) { return access(path.c_str(), X_OK) == 0; },
      .isStub = isDeveloperStub,
  };
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  if (auto packaged = packagedApp()) {
    setup.sandboxed = packaged->distribution == "mas";
    setup.capabilities = parseCapabilities(dynamicFrom(info[@"NGNCapabilities"]));
  } else if (!capabilitiesJson.empty()) {
    try {
      setup.capabilities = parseCapabilities(folly::parseJson(capabilitiesJson));
    } catch (const std::exception &error) {
      fprintf(stderr, "[ngn] --capabilities is not JSON (%s): no capabilities\n", error.what());
    }
  }
  return setup;
}

namespace {

NSURL *fileUrl(const std::string &path) {
  return [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
}

class WorkspaceOpener final : public ShellOpener {
 public:
  void openUrl(const std::string &url, std::function<void(bool)> done) override {
    NSURL *target = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
    onMain([target, done] { done(target != nil && [NSWorkspace.sharedWorkspace openURL:target]); });
  }
  void openPath(const std::string &path, std::function<void(bool)> done) override {
    NSURL *target = fileUrl(path);
    onMain([target, done] {
      BOOL exists = [NSFileManager.defaultManager fileExistsAtPath:target.path];
      done(exists && [NSWorkspace.sharedWorkspace openURL:target]);
    });
  }
  void showItemInFolder(const std::string &path, std::function<void(bool)> done) override {
    NSURL *target = fileUrl(path);
    onMain([target, done] {
      if (![NSFileManager.defaultManager fileExistsAtPath:target.path]) {
        done(false);
        return;
      }
      [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[ target ]];
      done(true);
    });
  }

 private:
  static void onMain(std::function<void()> task) {
    auto shared = std::make_shared<std::function<void()>>(std::move(task));
    dispatch_async(dispatch_get_main_queue(), ^{
      (*shared)();
    });
  }
};

} // namespace

std::shared_ptr<ShellOpener> makeShellOpener() {
  return std::make_shared<WorkspaceOpener>();
}

} // namespace ngn::appkit
