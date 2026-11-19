---
title: Focus and accessibility
summary: Tab order, composite widgets and VoiceOver in the desktop host.
---

# Focus and accessibility

How the desktop host moves the keyboard focus and what it tells VoiceOver.

## Tab order and focus

Tab and Shift-Tab move the focus in the order the core walks (`focus-order.h`), not AppKit's
key-view loop: positive `tabIndex` first, then focusable views, text inputs and controls in tree
order, inside the container the focus is in. With the Mac's default keyboard navigation Tab
reaches text inputs only, and Option-Tab reaches everything. A sheet, an in-window cover or a
popover keeps Tab inside it; the focus moves into it as it opens, to the first view in its Tab order
(else the container, labelled with the modal's accessibility label), and goes back to the view that
held it when it closes. A composite widget is one Tab stop, as WAI-ARIA has it: a view with the
`tablist`, `radiogroup`, `menu`, `menubar`, `listbox` or `grid` role is entered at its focused, else
its selected or checked, else its first item, and the arrow keys, Home and End move between its
items:

| Role                    | Keys                   | At the ends |
| ----------------------- | ---------------------- | ----------- |
| `tablist`, `radiogroup` | every arrow, Home, End | wraps       |
| `menu`                  | Up, Down, Home, End    | wraps       |
| `menubar`               | Left, Right, Home, End | wraps       |
| `listbox`               | Up, Down, Home, End    | stops       |
| `grid`                  | every arrow, Home, End | stops       |

A grid's rows are its `row` views: Home and End go to the ends of the row, and Control-Home and
Control-End to the grid's first and last cell. Left and Right swap in a right-to-left composite. An
item that takes no focus itself gives it to the first view inside it that does, a disabled radio is
skipped, and any `tabIndex`, -1 included, lets a view take the focus there (or from a click). The
host moves the focus only: an app that selects the tab or checks the radio on focus does so from
`(focus)`.

## VoiceOver

A view's accessibility props give it its NSAccessibility role, subrole, label, hint, value and
state, selected, disabled, checked and expanded included (`accessibility.h`). Every role the
components take is mapped; one AppKit lacks, such as `navigation`, is a group with the role's name
spoken, and a heading is AppKit's heading role with its `accessibilityLevel` from macOS 26 (a group
spoken as a heading before). A text is static text whose value is its string. A control, a heading
or an `accessible` view is read as one element, named by the text inside it when it has no label,
and a view with a role or a label keeps its children under it so that text is there to read.
`AccessibilityInfo` reads VoiceOver's state, reduce motion, reduce transparency, invert colours and
increase contrast from NSWorkspace, and sends their change events from its notifications; macOS has
no bold-text or grayscale setting, so those answer false.

`aria-labelledby` (`accessibilityLabelledBy`) and `aria-describedby` (`accessibilityDescribedBy`) on
a view or a text input name other views by their `nativeID` (or `id`), on the same window, in the
order written. An id no view has is skipped, and one several views have names the first made. On
macOS the text of the views named, each one's label or else the text inside it, is the view's label
and its help, read ahead of its own `accessibilityLabel` and `accessibilityHint`, and the first view
it is labelled by is its title element. On Linux they are GTK's labelled-by and described-by
relations, which GTK reads the name and description from, on a text input's field for a text input. Either follows the views it names as they
come, go or change their id.

## Actions

VoiceOver's actions come from `accessibilityActions`: `activate` is its press, `increment` and
`decrement` step an adjustable view, `escape` is its cancel, and any other is a custom action by its
label, sent back as `(accessibilityAction)`. VoiceOver's press (VO-Space), and Space or Return on a
focused view, send `(accessibilityTap)` or `activate` when the view listens for them, and otherwise
click the view at its centre, as iOS's synthesized tap does, so a `(press)` handler runs.

## Announcements and live regions

`announceForAccessibility` posts an announcement VoiceOver says, interrupting unless it asks to
queue or for low priority, and `setAccessibilityFocus` points VoiceOver at the view (and gives a
focusable view the keyboard). A live region (`accessibilityLiveRegion`, `aria-live`) says nothing
as it appears; after that each change to its text is announced, politely or, for `assertive`,
interrupting. Its text is its label, or else the text of the views under it, which the region keeps
under it rather than letting Fabric flatten them beside it (`live-regions.h`). macOS reports no end
to an announcement, so `announcementFinished` never fires.

## Rotors

The app's content in a window is one group to VoiceOver, holding its Headings, Links and Landmarks
rotors over the views inside it, in tree order: headings, links, and the views with a landmark role
(`banner`, `main`, `navigation`, `complementary`, `contentinfo`, `form`, `region`). AppKit fills
none of these for drawn views.
