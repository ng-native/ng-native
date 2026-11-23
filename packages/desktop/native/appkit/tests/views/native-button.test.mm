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

TEST_CASE("a button draws its SVG icon as a template image beside its title, sized to its text") {
  MountedViews m;
  auto save = MountedViews::shadow(
      2, "NgNativeButton", nativeButtonProps(folly::dynamic::object("title", "Save")("svgIcon", ngn::testing::kTopHalfIcon)));
  m.add(save);
  auto buttonOf = [&] {
    NSButton *button = (NSButton *)[m.view(2) keyboardResponder];
    REQUIRE([button isKindOfClass:NSButton.class]);
    return button;
  };
  NSImage *image = buttonOf().image;
  REQUIRE((image != nil));
  CHECK([image isTemplate]);
  CHECK(buttonOf().imagePosition == NSImageLeading);
  // 13 points of text at the regular size.
  CHECK(image.size.width == 16);
  CHECK(ngn::testing::imageAlpha(image, 16, 8, 2) == doctest::Approx(1));
  CHECK(ngn::testing::imageAlpha(image, 16, 8, 13) == doctest::Approx(0));

  m.update(save, nativeButtonProps(folly::dynamic::object("title", "Save")("svgIcon", ngn::testing::kTopHalfIcon)("controlSize", "small")));
  CHECK(buttonOf().image.size.width < 16);

  m.update(save, nativeButtonProps(folly::dynamic::object("title", "Save")));
  CHECK((buttonOf().image == nil));
  CHECK(buttonOf().imagePosition == NSNoImage);
}
