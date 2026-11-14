// Tab order, walked in the core over the committed tree, the same on every toolkit: what Tab and
// Shift-Tab move the focus to. AppKit's key-view loop is not used.
//
// A view is in Tab order when its desktop props say it takes focus (`focusable`, or a `tabIndex`
// of 0 or more), or when it is a text input or a native control (native-controls.h) that a
// negative `tabIndex` or `focusable: false` does not take out. Positive `tabIndex` values come
// first, lowest first, then everything else in tree order, as on the web. Covered screens, views
// with `display: none` and other containers' content (a popover's, a sheet's) are skipped: the walk
// stays inside the container it starts in, which keeps Tab inside a modal.
#pragma once

#include "ngn/view-tree.h"

#include <optional>
#include <vector>

namespace ngn {

// How far Tab reaches, from the system's keyboard navigation setting: every focusable view, or
// only text inputs (the Mac's default, where Option-Tab reaches everything).
enum class TabReach { TextInputs, All };

// The views Tab visits in the container `root`, in order.
std::vector<Tag> tabOrder(const ViewTree &tree, Tag root, TabReach reach);

// Where Tab (or Shift-Tab, `backwards`) moves the focus from `from`, wrapping round; the first
// (or last) view when `from` is not in Tab order. Nothing when no view is.
std::optional<Tag> nextInTabOrder(
    const ViewTree &tree,
    Tag root,
    std::optional<Tag> from,
    bool backwards,
    TabReach reach);

} // namespace ngn
