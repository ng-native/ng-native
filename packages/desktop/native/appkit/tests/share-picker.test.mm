// The share picker's half that needs no window (share-picker.mm): the items a request becomes, and
// how a share is answered as the picker and the service report. Nothing is shown.
#include "../share-picker.h"

#include <doctest/doctest.h>

namespace {

using Request = ngn::SharePicker::Request;

NSArray *items(Request request) {
  return ngn::appkit::shareItems(request);
}

// A picker made and never shown.
NSSharingServicePicker *unshown() {
  return [[NSSharingServicePicker alloc] initWithItems:@[ @"x" ]];
}

NSSharingService *service(NSString *title) {
  return [[NSSharingService alloc] initWithTitle:title image:[NSImage new] alternateImage:nil handler:^{}];
}

} // namespace

TEST_CASE("shareItems shares the message as text, then the url, in React Native iOS's order") {
  NSArray *both = items({.message = "Look", .url = "https://example.com/a?b=1", .title = "Subject"});
  REQUIRE(both.count == 2);
  CHECK([both[0] isEqual:@"Look"]);
  REQUIRE([both[1] isKindOfClass:NSURL.class]);
  CHECK([[both[1] absoluteString] isEqualToString:@"https://example.com/a?b=1"]);
  CHECK_FALSE([both[1] isFileURL]);
  NSArray *text = items({.message = "Only text"});
  CHECK(text.count == 1);
  CHECK([text[0] isKindOfClass:NSString.class]);
}

TEST_CASE("shareItems shares a file uri or a path as the file itself") {
  NSArray *file = items({.url = "file:///Users/me/My%20Notes/plan.pdf"});
  REQUIRE(file.count == 1);
  REQUIRE([file[0] isKindOfClass:NSURL.class]);
  CHECK([file[0] isFileURL]);
  CHECK([[file[0] path] isEqualToString:@"/Users/me/My Notes/plan.pdf"]);
  NSArray *path = items({.url = "/tmp/report.csv"});
  CHECK([path[0] isFileURL]);
  CHECK([[path[0] path] isEqualToString:@"/tmp/report.csv"]);
  // Something NSURL cannot read as a url with a scheme is shared as the text it is.
  NSArray *odd = items({.url = "not a url"});
  CHECK([odd[0] isKindOfClass:NSString.class]);
  CHECK([odd[0] isEqual:@"not a url"]);
}

TEST_CASE("NGNSharePickerDelegate answers the service once it has shared, with the title as its subject") {
  std::vector<std::optional<std::string>> answers;
  NGNSharePickerDelegate *delegate =
      [[NGNSharePickerDelegate alloc] initWithTitle:std::string("Weekly plan")
                                               done:[&](std::optional<std::string> s) { answers.push_back(s); }];
  NSSharingService *mail = service(@"Mail");
  bool same = [delegate sharingServicePicker:unshown() delegateForSharingService:mail] == delegate;
  CHECK(same);
  [delegate sharingServicePicker:unshown() didChooseSharingService:mail];
  CHECK([mail.subject isEqualToString:@"Weekly plan"]);
  CHECK(answers.empty());
  [delegate sharingService:mail didShareItems:@[]];
  // Answered once, whatever reports after.
  [delegate sharingService:mail didFailToShareItems:@[] error:[NSError errorWithDomain:@"x" code:1 userInfo:nil]];
  REQUIRE(answers.size() == 1);
  CHECK(answers[0] == std::optional<std::string>("Mail"));
}

TEST_CASE("NGNSharePickerDelegate answers a dismissed picker or a failed service as nothing shared") {
  std::vector<std::optional<std::string>> answers;
  auto record = [&](std::optional<std::string> s) { answers.push_back(s); };
  NGNSharePickerDelegate *dismissed = [[NGNSharePickerDelegate alloc] initWithTitle:std::nullopt done:record];
  [dismissed sharingServicePicker:unshown() didChooseSharingService:nil];
  NGNSharePickerDelegate *failed = [[NGNSharePickerDelegate alloc] initWithTitle:std::nullopt done:record];
  NSSharingService *messages = service(@"Messages");
  [failed sharingServicePicker:unshown() didChooseSharingService:messages];
  bool noSubject = messages.subject == nil;
  CHECK(noSubject);
  [failed sharingService:messages didFailToShareItems:@[] error:[NSError errorWithDomain:@"x" code:1 userInfo:nil]];
  REQUIRE(answers.size() == 2);
  CHECK_FALSE(answers[0]);
  CHECK_FALSE(answers[1]);
}

TEST_CASE("AppKitSharePicker answers nothing shared where there is no window to show it on") {
  auto picker = ngn::appkit::makeSharePicker();
  std::optional<std::optional<std::string>> answer;
  picker->show({.message = "Hi"}, [&](std::optional<std::string> s) { answer = s; });
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!answer && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
  }
  REQUIRE(answer);
  CHECK_FALSE(*answer);
}
