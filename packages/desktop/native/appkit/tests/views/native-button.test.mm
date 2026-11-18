// `<native-button>` as an NSButton (native-controls.mm): the keys its kind gives it in its window.
#include "mounted-views.h"

#include <doctest/doctest.h>

using ngn::testing::MountedViews;
using ngn::testing::nativeButtonProps;

namespace {

NSString *keyOf(const MountedViews &m, facebook::react::Tag tag) {
  NSButton *button = (NSButton *)[m.view(tag) keyboardResponder];
  REQUIRE([button isKindOfClass:NSButton.class]);
  return button.keyEquivalent;
}

} // namespace

TEST_CASE("only a default button takes Return, a cancel one takes Escape, and one with no kind takes neither") {
  MountedViews m;
  auto plain = MountedViews::shadow(2, "NgNativeButton", nativeButtonProps(folly::dynamic::object("title", "Later")));
  m.add(plain);
  m.add(MountedViews::shadow(3, "NgNativeButton", nativeButtonProps(folly::dynamic::object("title", "Save")("kind", "default")), 30));
  m.add(MountedViews::shadow(4, "NgNativeButton", nativeButtonProps(folly::dynamic::object("title", "Cancel")("kind", "cancel")), 60));
  m.add(MountedViews::shadow(5, "NgNativeButton", nativeButtonProps(folly::dynamic::object("title", "Delete")("kind", "destructive")), 90));

  CHECK([keyOf(m, 2) isEqualToString:@""]);
  CHECK([keyOf(m, 3) isEqualToString:@"\r"]);
  CHECK([keyOf(m, 4) isEqualToString:@"\x1b"]);
  CHECK([keyOf(m, 5) isEqualToString:@""]);

  // A kind a later commit sets, then takes away.
  m.update(plain, nativeButtonProps(folly::dynamic::object("title", "Later")("kind", "default")));
  CHECK([keyOf(m, 2) isEqualToString:@"\r"]);
  m.update(plain, nativeButtonProps(folly::dynamic::object("title", "Later")));
  CHECK([keyOf(m, 2) isEqualToString:@""]);
}
