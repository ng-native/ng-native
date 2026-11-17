// react-native-screens' presented screens on a desktop: an RNSScreen whose `stackPresentation` is
// not `push` is presented over the stack rather than pushed onto it, the way <modal> is
// (desktop-modal.h): `modal`, `formSheet` and `pageSheet` as a sheet on the window,
// `fullScreenModal`, `transparentModal` and the contained ones as a cover in the window, and any
// with an `anchor` (the react tag of a view, which `present()` writes) as a popover at that view.
//
// The core registers RNSScreen with these props, with the library's event emitter, in place of the
// library's own (library-glue.h): the library's props drop `anchor`. Its state is SplitPaneState, the
// size the toolkit presents it at, which it takes in layout.
//
// A sheet draws the screen's header itself, since a sheet has no toolbar: the title is a heading
// at the top, and the bar buttons a row at the bottom right, the left ones (Cancel) first and
// bound to Escape, the right ones after, the last of them the default button on Return. A popover
// draws no header; its title is the popover's accessibility label.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/header-bar.h"

#include <react/renderer/components/view/ViewProps.h>

#include <optional>
#include <string>
#include <vector>

namespace ngn {

class ScreenProps final : public facebook::react::ViewProps {
 public:
  ScreenProps() = default;
  ScreenProps(
      const facebook::react::PropsParserContext &context,
      const ScreenProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  std::string stackPresentation{"push"};
  // 0 for none.
  int anchor{0};
  // Whether the OS's back gesture may leave the screen (a back swipe, back-swipe.h).
  bool gestureEnabled{true};
  // How the screen arrives and leaves: `none` and `fade` change how a back swipe moves it.
  std::string stackAnimation{"default"};
};

// How a screen with these props is presented, or nothing for one pushed onto its stack (or props
// that are not a screen's).
std::optional<ModalPresentation> screenPresentation(const facebook::react::Props &props);

// The heading's and the button row's heights in a sheet, in points.
constexpr facebook::react::Float kSheetHeadingHeight = 44;
constexpr facebook::react::Float kSheetButtonRowHeight = 52;

struct SheetButton {
  std::string id;
  std::string title;
  // The first left item: Escape presses it. Only one button has it.
  bool cancel{false};
  // The last right item: Return presses it.
  bool isDefault{false};
  bool disabled{false};
  bool operator==(const SheetButton &) const = default;
};

struct SheetChrome {
  // Empty for none.
  std::string heading;
  std::vector<SheetButton> buttons;
  // What names the presentation, in a popover too, when the screen has no accessibility label of
  // its own (presentationLabel, desktop-modal.h): the title.
  std::string label;
  bool operator==(const SheetChrome &) const = default;

  facebook::react::Float top() const {
    return heading.empty() ? 0 : kSheetHeadingHeight;
  }
  facebook::react::Float bottom() const {
    return buttons.empty() ? 0 : kSheetButtonRowHeight;
  }
};

// What a presented screen's header becomes inside its presentation. A popover's is only the label;
// a cover keeps the window's toolbar.
SheetChrome sheetChrome(const HeaderBar &header, ModalPresentation presentation);

} // namespace ngn
