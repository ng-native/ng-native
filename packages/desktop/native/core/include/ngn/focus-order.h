// Tab order, walked in the core over the committed tree, the same on every toolkit: what Tab and
// Shift-Tab move the focus to. AppKit's key-view loop is not used.
//
// A view is in Tab order when its desktop props say it takes focus (`focusable`, or a `tabIndex`
// of 0 or more), or when it is a text input or a native control (native-controls.h) that a
// negative `tabIndex` or `focusable: false` does not take out. Positive `tabIndex` values come
// first, lowest first, then everything else in tree order, as on the web. Covered screens, views
// with `display: none` and other containers' content (a popover's, a sheet's) are skipped: the walk
// stays inside the container it starts in, which keeps Tab inside a modal.
//
// A composite widget (a view with the `tablist`, `radiogroup`, `menu`, `menubar`, `listbox` or
// `grid` role) is one Tab stop, as WAI-ARIA has it: the item in it with the focus, else its
// selected or checked item, else its first. Arrow keys, Home and End move the focus between its
// items (compositeMove). A text input inside one keeps a Tab stop of its own.
#pragma once

#include "ngn/view-tree.h"

#include <optional>
#include <vector>

namespace ngn {

// How far Tab reaches, from the system's keyboard navigation setting: every focusable view, or
// only text inputs (the Mac's default, where Option-Tab reaches everything).
enum class TabReach { TextInputs, All };

// The views Tab visits in the container `root`, in order. `focused` is the view with the focus,
// which is a composite widget's stop.
std::vector<Tag> tabOrder(const ViewTree &tree, Tag root, TabReach reach, std::optional<Tag> focused = std::nullopt);

// Where Tab (or Shift-Tab, `backwards`) moves the focus from `from`, wrapping round; the first
// (or last) view when `from` is not in Tab order. Nothing when no view is.
std::optional<Tag> nextInTabOrder(
    const ViewTree &tree,
    Tag root,
    std::optional<Tag> from,
    bool backwards,
    TabReach reach);

// The keys that move the focus inside a composite widget. Left and Right are as pressed: a
// right-to-left composite swaps them.
enum class CompositeKey { Left, Right, Up, Down, Home, End };

// Where `key` moves the focus from `focused` inside the nearest composite widget around it, under
// `root`, as WAI-ARIA's practices have it:
// - `tablist` and `radiogroup`: every arrow, the previous or the next item, wrapping round;
// - `menu`: Up and Down, wrapping; `menubar`: Left and Right, wrapping;
// - `listbox`: Up and Down, stopping at either end;
// - `grid`: the next cell in the row or the column, stopping at the edges, its `row` views being
//   the rows; Home and End go to the row's ends, and with `control` to the grid's first and last.
// Home and End go to the first and last item elsewhere. The items are the views with the role the
// composite takes (`tab`; `radio`; `menuitem`, `menuitemcheckbox` and `menuitemradio`; `option`;
// `gridcell`, `cell`, `columnheader` and `rowheader`), outside any composite nested in it, focused
// themselves or, when one takes no focus, through the first view inside it that does. A disabled
// radio is skipped; other disabled items are not, as WAI-ARIA recommends.
//
// The focused view itself at an edge that does not wrap: the key is used and nothing moves.
// Nothing when the focus is in no composite, the key is not one it uses, or the focus is in a text
// input or a native control that uses the arrows itself.
std::optional<Tag> compositeMove(const ViewTree &tree, Tag root, Tag focused, CompositeKey key, bool control);

} // namespace ngn
