// `<text-input>`'s text and placeholder aligned as React Native iOS aligns a TextInput's: by the
// layout's direction when no alignment is set, single line and multiline, as the props and the
// layout change. Read from what the mounted view draws.
#include "mounted-views.h"

#include <doctest/doctest.h>

#include <cmath>
#include <utility>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::textInputProps;

namespace {

constexpr int64_t kRed = 0xFFFF0000;

// The share of the view's width where its red ink starts and ends, or {-1, -1} with none.
std::pair<double, double> redSpan(NSView *view) {
  [view.window.contentView layoutSubtreeIfNeeded];
  NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
  NSInteger first = -1, last = -1;
  for (NSInteger x = 0; x < bitmap.pixelsWide; x++) {
    for (NSInteger y = 0; y < bitmap.pixelsHigh; y++) {
      NSColor *c = [[bitmap colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      if (c.alphaComponent > 0.5 && c.redComponent > 0.7 && c.greenComponent < 0.4 && c.blueComponent < 0.4) {
        first = first < 0 ? x : first;
        last = x;
        break;
      }
    }
  }
  if (first < 0) {
    return {-1, -1};
  }
  double wide = static_cast<double>(bitmap.pixelsWide);
  return {first / wide, (last + 1) / wide};
}

bool onTheLeft(NSView *view) {
  auto [start, end] = redSpan(view);
  return start >= 0 && start < 0.1 && end < 0.5;
}

bool onTheRight(NSView *view) {
  auto [start, end] = redSpan(view);
  return start > 0.5 && end > 0.9;
}

bool centred(NSView *view) {
  auto [start, end] = redSpan(view);
  return start > 0.2 && end < 0.8 && std::abs((start + end) / 2 - 0.5) < 0.1;
}

// The base writing direction of the NSTextField or NSTextView inside the mounted view.
NSWritingDirection baseWritingDirection(NSView *view) {
  for (NSView *child in view.subviews) {
    if ([child isKindOfClass:NSTextField.class]) {
      return ((NSTextField *)child).baseWritingDirection;
    }
    if ([child isKindOfClass:NSTextView.class]) {
      // A text view answers natural with the direction it resolves to, so read its typing style.
      NSParagraphStyle *style = ((NSTextView *)child).typingAttributes[NSParagraphStyleAttributeName];
      return style ? style.baseWritingDirection : NSWritingDirectionNatural;
    }
    NSWritingDirection inside = baseWritingDirection(child);
    if (inside != NSWritingDirectionNatural) {
      return inside;
    }
  }
  return NSWritingDirectionNatural;
}

ShadowView input(folly::dynamic raw, LayoutDirection direction) {
  auto view = MountedViews::shadow(5, "TextInput", textInputProps(std::move(raw)));
  view.layoutMetrics.frame = {{10, 10}, {300, 60}};
  view.layoutMetrics.layoutDirection = direction;
  return view;
}

// Commits a new layout direction to the mounted input, as a reload with another one lays it out.
void relayout(MountedViews &mounted, LayoutDirection direction) {
  auto current = mounted.mounting->tree().find(5)->view;
  auto next = current;
  next.layoutMetrics.layoutDirection = direction;
  mounted.mount({ShadowViewMutation::UpdateMutation(current, next, MountedViews::kSurface)});
}

} // namespace

TEST_CASE("A text input aligns its text and placeholder as React Native iOS does, single line and multiline") {
  for (bool multiline : {false, true}) {
    INFO("multiline ", multiline);
    MountedViews mounted;
    folly::dynamic placeholder = folly::dynamic::object("placeholder", "Name")("placeholderTextColor", kRed)("multiline", multiline);
    auto view = input(placeholder, LayoutDirection::RightToLeft);
    mounted.add(view);
    NGNView *field = mounted.view(5);
    bool mountedField = field != nil;
    REQUIRE(mountedField);

    // No alignment: the layout's leading side, for the placeholder and the text.
    CHECK(onTheRight(field));
    relayout(mounted, LayoutDirection::LeftToRight);
    CHECK(onTheLeft(field));
    relayout(mounted, LayoutDirection::RightToLeft);
    CHECK(onTheRight(field));
    folly::dynamic aligned = placeholder;
    aligned["textAlign"] = "left";
    mounted.update(view, textInputProps(aligned));
    CHECK(onTheLeft(field));
    mounted.update(view, textInputProps(placeholder));
    CHECK(onTheRight(field));

    auto text = [&](folly::dynamic extra) {
      folly::dynamic raw = folly::dynamic::object("text", "Hello")("color", kRed)("multiline", multiline);
      raw.update(extra);
      return textInputProps(std::move(raw));
    };
    mounted.update(view, text(folly::dynamic::object()));
    CHECK(onTheRight(field));
    relayout(mounted, LayoutDirection::LeftToRight);
    CHECK(onTheLeft(field));

    // An alignment that is set is not turned round in right to left, as on iOS, where a
    // TextInput's text attributes have no layout direction.
    relayout(mounted, LayoutDirection::RightToLeft);
    mounted.update(view, text(folly::dynamic::object("textAlign", "left")));
    CHECK(onTheLeft(field));
    mounted.update(view, text(folly::dynamic::object("textAlign", "auto")));
    CHECK(onTheLeft(field));
    mounted.update(view, text(folly::dynamic::object("textAlign", "center")));
    CHECK(centred(field));
    relayout(mounted, LayoutDirection::LeftToRight);
    mounted.update(view, text(folly::dynamic::object("textAlign", "right")));
    CHECK(onTheRight(field));

    // writingDirection sets the base writing direction, natural when it goes.
    mounted.update(view, text(folly::dynamic::object("writingDirection", "rtl")));
    CHECK(baseWritingDirection(field) == NSWritingDirectionRightToLeft);
    mounted.update(view, text(folly::dynamic::object("writingDirection", "ltr")));
    CHECK(baseWritingDirection(field) == NSWritingDirectionLeftToRight);
    mounted.update(view, text(folly::dynamic::object()));
    CHECK(baseWritingDirection(field) == NSWritingDirectionNatural);
  }
}
