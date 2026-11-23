// `<native-header>`'s subtitle as the window's (header-toolbar.mm): set from the header in front,
// changed with it, and cleared when the header has none or no header is in front. The header's
// props come through the library glue, which the test replaces with its own.
#include "mounted-views.h"

#include "ngn/library-components.h"
#include "ngn/library-glue.h"
#include "ngn/screen-stacks.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::viewProps;

namespace {

struct HeaderProps final : ViewProps {
  ngn::HeaderBar bar;
};

Props::Shared header(const std::string &title, const std::string &subtitle) {
  auto props = std::make_shared<HeaderProps>();
  props->bar.title = title;
  props->bar.subtitle = subtitle;
  return props;
}

struct Glue {
  // The libraries' own glue is installed the first time their components are asked for, which
  // would replace this one: it goes in first, and is what is restored.
  ngn::LibraryGlue saved = (ngn::libraryComponents(), ngn::libraryGlue());
  Glue() {
    ngn::libraryGlue().headerBar = [](const Props &props) -> std::optional<ngn::HeaderBar> {
      const auto *p = dynamic_cast<const HeaderProps *>(&props);
      return p ? std::optional(p->bar) : std::nullopt;
    };
  }
  ~Glue() {
    ngn::libraryGlue() = saved;
  }
};

} // namespace

TEST_CASE("A header's subtitle is the window's while it is in front, and goes with it") {
  Glue glue;
  MountedViews m;
  m.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  auto config = MountedViews::shadow(5, "RNSScreenStackHeaderConfig", header("Inbox", "3 waiting"));
  m.add(config, 4);
  auto front = ngn::ScreenStacks::FrontHeader{.config = 5, .screen = 4};
  m.backend->setFrontHeader(MountedViews::kSurface, front);
  CHECK([m.window.title isEqualToString:@"Inbox"]);
  CHECK([m.window.subtitle isEqualToString:@"3 waiting"]);

  m.update(config, header("Inbox", "2 waiting"));
  m.backend->setFrontHeader(MountedViews::kSurface, front);
  CHECK([m.window.subtitle isEqualToString:@"2 waiting"]);

  m.update(config, header("Inbox", ""));
  m.backend->setFrontHeader(MountedViews::kSurface, front);
  CHECK([m.window.subtitle isEqualToString:@""]);

  m.update(config, header("Inbox", "1 waiting"));
  m.backend->setFrontHeader(MountedViews::kSurface, front);
  m.backend->setFrontHeader(MountedViews::kSurface, std::nullopt);
  CHECK([m.window.subtitle isEqualToString:@""]);
}
