// The accessibility label a sheet's, cover's or popover's container gets (presentation-label.h): what
// the Accessibility API reports as its description, which VoiceOver reads as its name.
#include "../presentation-label.h"

#include <doctest/doctest.h>

TEST_CASE("a presentation's container is named by its own label, else its title, and follows both") {
  NSView *container = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 100)];

  ngn::appkit::labelPresentation(container, "Labelled modal", "");
  CHECK([container.accessibilityLabel isEqualToString:@"Labelled modal"]);
  // The label changes: the container follows it.
  ngn::appkit::labelPresentation(container, "Renamed modal", "");
  CHECK([container.accessibilityLabel isEqualToString:@"Renamed modal"]);
  // Its own label wins over a title.
  ngn::appkit::labelPresentation(container, "Renamed modal", "Filters");
  CHECK([container.accessibilityLabel isEqualToString:@"Renamed modal"]);
  // The label goes: the title names it, and a new title renames it.
  ngn::appkit::labelPresentation(container, "", "Filters");
  CHECK([container.accessibilityLabel isEqualToString:@"Filters"]);
  ngn::appkit::labelPresentation(container, "", "Renamed filters");
  CHECK([container.accessibilityLabel isEqualToString:@"Renamed filters"]);
  // Neither: no name, rather than the last one.
  ngn::appkit::labelPresentation(container, "", "");
  CHECK((container.accessibilityLabel == nil));
}
