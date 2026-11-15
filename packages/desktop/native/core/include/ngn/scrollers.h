// Scroll bars that follow the user's "Show scroll bars" setting. Overlay scrollers float over the
// content; legacy ones (the setting's "Always", or "Automatically" with a mouse) take a strip of
// the scroll view, so the content has to be laid out that much narrower, as a browser does for a
// classic scroll bar.
//
// The toolkit says which style is in force and how wide a legacy scroller is, and each mounted
// scroll view reports the gutter its scrollers take (scrollerGutter). DesktopScrollViewShadowNode
// reads its own as it is made or cloned and pads its content by it, so the toolkit asks for a new
// layout by updating the scroll view's state once its gutter has changed.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/scrollview/ScrollViewEventEmitter.h>
#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/graphics/Size.h>

#include <mutex>
#include <unordered_map>

namespace ngn {

enum class ScrollerStyle { Overlay, Legacy };

// What a scroll view's scrollers take from its content, in points: the vertical scroller's strip
// on the right, the horizontal one's at the bottom.
struct ScrollerGutter {
  float right{0};
  float bottom{0};
  bool operator==(const ScrollerGutter &) const = default;
};

// Which scrollers a scroll view shows, and whether AppKit hides them when the content fits.
struct ScrollerVisibility {
  bool vertical{false};
  bool horizontal{false};
  bool autohides{true};
  bool operator==(const ScrollerVisibility &) const = default;
};

// A scroller along an axis the content overflows, or always the vertical one for
// `scrollbar-gutter: stable`; none for `scrollbar-width: none` or an indicator turned off.
ScrollerVisibility scrollerVisibility(
    const DesktopProps &props,
    bool showsVertical,
    bool showsHorizontal,
    facebook::react::Size content,
    facebook::react::Size view);

// The gutter the visible scrollers take: their width for legacy scrollers, nothing for overlay.
ScrollerGutter scrollerGutter(ScrollerStyle style, float legacyWidth, const ScrollerVisibility &visibility);

// `style` with `gutter` added to the padding Yoga reads for the right and bottom edges in
// `direction`. A percentage or `auto` there is left alone.
facebook::yoga::Style withGutter(
    const facebook::yoga::Style &style,
    ScrollerGutter gutter,
    facebook::yoga::Direction direction);

// The gutters of the mounted scroll views, by tag: set on the UI thread, read as Yoga lays out.
class ScrollerGutters {
 public:
  static ScrollerGutters &shared();
  // True when the gutter changed, so the scroll view needs a new layout.
  bool set(facebook::react::Tag tag, ScrollerGutter gutter);
  ScrollerGutter get(facebook::react::Tag tag) const;
  void remove(facebook::react::Tag tag);

 private:
  mutable std::mutex mutex_;
  std::unordered_map<facebook::react::Tag, ScrollerGutter> gutters_;
};

// React Native's ScrollViewShadowNode (which is final), padding its content by its gutter.
class DesktopScrollViewShadowNode final : public facebook::react::ConcreteViewShadowNode<
                                              facebook::react::ScrollViewComponentName,
                                              facebook::react::ScrollViewProps,
                                              facebook::react::ScrollViewEventEmitter,
                                              facebook::react::ScrollViewState> {
 public:
  DesktopScrollViewShadowNode(
      const facebook::react::ShadowNodeFragment &fragment,
      const facebook::react::ShadowNodeFamily::Shared &family,
      facebook::react::ShadowNodeTraits traits);
  DesktopScrollViewShadowNode(
      const facebook::react::ShadowNode &sourceShadowNode,
      const facebook::react::ShadowNodeFragment &fragment);

  static facebook::react::ScrollViewState initialStateData(
      const facebook::react::Props::Shared &props,
      const facebook::react::ShadowNodeFamily::Shared &family,
      const facebook::react::ComponentDescriptor &componentDescriptor);

  void layout(facebook::react::LayoutContext layoutContext) override;
  facebook::react::Point getContentOriginOffset(bool includeTransform) const override;

 private:
  void applyGutter(facebook::yoga::Direction direction);
  void updateStateIfNeeded();
  void updateScrollContentOffsetIfNeeded();
};

} // namespace ngn
