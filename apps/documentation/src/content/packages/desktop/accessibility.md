---
title: Focus and accessibility
summary: Tab order, composite widgets, VoiceOver on a Mac and Orca on Linux in the desktop host.
---

# Focus and accessibility

How the desktop host moves the keyboard focus and what it tells VoiceOver, and on Linux Orca.
[On Linux](#on-linux) says where Linux differs, and the one thing it lacks.

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
relations, which GTK reads the name and description from, on a text input's field for a text input.
Either follows the views it names as they come, go or change their id.

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

## On Linux

The focus keys, composite widgets and `tabIndex` behave as above, because the core owns the focus
order on both desktops. A window's key handling gives Tab, Shift-Tab and a composite widget's
arrows to the core before GTK sees them, and each move gives real GTK focus to the view's widget,
so a screen reader hears it. Where a Mac's default keyboard navigation reaches text inputs only,
Tab on Linux reaches every focusable view. Space and Return press the focused view as they do on a
Mac (the keypad's Enter too, as it presses a GTK button), and a window's default button takes
Return first.

The accessibility tree is GTK's own, read by Orca and other AT-SPI clients. Each view's widget is
made with the GTK role for its ARIA role, from `role` or `accessibilityRole`, and its label,
description, value, heading level and its selected, disabled, checked and expanded states follow
the props. A text is named by its string, and a text input's field is the text box, with the input's
label. GTK fixes a widget's role when it makes it, so a view whose role changes gets a new widget in
its place, with its children and the focus. `article` is a group, since GTK's article role is newer
than the 4.10 the host builds against.

`AccessibilityInfo` reads the desktop's settings and follows them as they change:

| Setting           | Read from                                                                          |
| ----------------- | ---------------------------------------------------------------------------------- |
| Screen reader     | AT-SPI's `org.a11y.Status`                                                         |
| Reduce motion     | the Settings portal's reduced-motion, GTK 4.22's setting, or animations turned off |
| Increase contrast | the Settings portal's contrast (libadwaita's high contrast), or GTK 4.20's setting |

Linux has no reduce-transparency, invert-colours, bold-text or grayscale setting an app can read,
so those answer false. A source that is not there, such as an older GTK, no portal or no AT-SPI
bus, counts as off.

`announceForAccessibility` and a live region's changes are announced through
`gtk_accessible_announce`, which the host looks for as it runs: on GTK 4.14 and later Orca says
them, and below it, as on Red Hat Enterprise Linux 9's GTK 4.12, they say nothing.
`setAccessibilityFocus` does nothing on Linux.

### Orca's structural navigation

Orca's keys for moving by structure, H and 1 to 6 for headings, M for landmarks, and B and F for
buttons and form fields, find nothing in a GTK 4 app, an Angular Native app included. They need the
AT-SPI Collection interface, which GTK 4 does not implement. A view's heading level and landmark
role are set on its widget, but Orca cannot jump between them, as VoiceOver's Headings,
Links and Landmarks rotors let a Mac user do. The gap is GTK's, not the app's: the same keys find
nothing in other GTK 4 apps. Orca does speak each control's role, name and state as the focus
moves through the app by Tab.
