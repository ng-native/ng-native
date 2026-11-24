// The desktop props as plain values (desktop-view-props.h parses them), in a header of their own
// because React Native's view traits read them too: the shim's HostPlatformViewTraitsInitializer.h
// keeps a view that has any of them from being flattened away, as React Native does for a view
// with an event listener or a cursor.
#pragma once

#include <folly/dynamic.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/core/ReactPrimitives.h>

#include <optional>
#include <string>
#include <vector>

namespace ngn {

using facebook::react::SurfaceId;
using facebook::react::Tag;

// CSS's `scrollbar-width` and `scrollbar-gutter`.
enum class ScrollbarWidth { Auto, Thin, None };
enum class ScrollbarGutter { Auto, Stable };

// CSS's `-webkit-font-smoothing` on the text a view draws, as Chrome on a Mac draws it: Core Graphics' font
// smoothing (`auto`, and `subpixel-antialiased`, which no Mac display draws differently), none of
// it (`antialiased`), or no antialiasing at all (`none`).
enum class FontSmoothing { Auto, Antialiased, None };

// How a ModalHostView shows (desktop-modal.h): a sheet on its window, a cover in the window, or a
// popover at its anchor.
enum class ModalPresentation { Sheet, Cover, Popover };

// The ARIA states and counts no React Native prop carries, as the components commit them: whether a
// field is required or invalid, an item's place in its set, and a grid's row and column counts.
struct AriaFields {
  bool required{false};
  bool invalid{false};
  std::optional<int> posInSet;
  std::optional<int> setSize;
  std::optional<int> rowCount;
  std::optional<int> columnCount;

  bool operator==(const AriaFields &other) const = default;
};

struct DesktopProps {
  // Unset means the toolkit's default for the component.
  std::optional<bool> focusable;
  // Unset means no explicit place in Tab order. Negative leaves the view out of it.
  std::optional<int> tabIndex;
  // ModalHostView only: the view it is anchored to, as a popover (desktop-modal.h).
  std::optional<Tag> anchor;
  // The CSS cursor as written, when React Native's `cursor` cannot say it. Unset defers to
  // `cursor`, then to the nearest ancestor's (input-dispatcher.h).
  std::optional<facebook::react::Cursor> cursor;
  // ScrollView only.
  ScrollbarWidth scrollbarWidth{ScrollbarWidth::Auto};
  ScrollbarGutter scrollbarGutter{ScrollbarGutter::Auto};
  // Whether a binding listens for the element event, which is then sent to the view.
  bool onDoubleClick{false};
  bool onContextMenu{false};
  bool onWheel{false};
  // Whether the view takes files, text and urls dragged onto it (input-dispatcher.h).
  bool fileDrop{false};
  // The `dragItem` prop: `{ files, text, url }` the view offers when dragged out, or null for none.
  folly::dynamic dragItem{nullptr};
  // The `contextMenu` prop: the entries of the menu a secondary click shows, as the app sends them
  // (app-menus.h), or null for none.
  folly::dynamic contextMenu{nullptr};
  // `role` as written. React Native's Role has no `listbox`, `gridcell`, `menuitemcheckbox` or
  // `menuitemradio` and drops them; the core reads them from here (accessibility.h roleName).
  std::string role;
  // `accessibilityLevel` (`aria-level`): a heading's level, from 1.
  std::optional<int> accessibilityLevel;
  // `accessibilityDescribedBy` (`aria-describedby`): the nativeIDs of the views that describe this
  // one (accessibility-relations.h). React Native's ViewProps has `accessibilityLabelledBy`.
  std::vector<std::string> accessibilityDescribedBy;
  // `accessibilityRequired` (`aria-required`) and the rest of the ARIA states and counts React
  // Native's ViewProps lacks (accessibility.h AxInfo).
  AriaFields aria;
  // ModalHostView only.
  ModalPresentation presentation{ModalPresentation::Sheet};
  // A Paragraph's and a native control's that draws text, such as the search field. The engine
  // commits it on macOS alone.
  FontSmoothing fontSmoothing{FontSmoothing::Auto};

  bool operator==(const DesktopProps &other) const = default;
};

// What a props class with desktop props carries beside its React Native base.
struct HasDesktopProps {
  DesktopProps desktop;
};

// Whether a view with these props must be a view of its own, with its children under it: the
// hit test, the cursor and Tab order all read it, and a flattened view is not mounted.
inline bool formsStackingContext(const DesktopProps &props) {
  return props.focusable.value_or(false) || props.tabIndex.has_value() || props.cursor.has_value() ||
      !props.role.empty() || !props.accessibilityDescribedBy.empty() || props.onDoubleClick || props.onContextMenu || props.onWheel || props.fileDrop || !props.dragItem.isNull() ||
      !props.contextMenu.isNull();
}

} // namespace ngn
