#include "helpers.h"
#include "ngn/accessibility-relations.h"
#include "ngn/desktop-view-props.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::AxRelations;
using ngn::testing::shadowView;

namespace {

// A view's props: its nativeID, and the ids it is labelled and described by.
Props::Shared props(std::string id, std::vector<std::string> labelledBy = {}, std::vector<std::string> describedBy = {}) {
  auto p = std::make_shared<ngn::DesktopViewProps>();
  p->nativeId = std::move(id);
  p->accessibilityLabelledBy.value = std::move(labelledBy);
  p->desktop.accessibilityDescribedBy = std::move(describedBy);
  return p;
}

ShadowView view(Tag tag, Props::Shared p, SurfaceId surface = 1) {
  auto v = shadowView(tag, "View", {{0, 0}, {10, 10}}, std::move(p));
  v.surfaceId = surface;
  return v;
}

using Changes = std::vector<std::pair<Tag, AxRelations>>;

} // namespace

TEST_CASE("a view's relations resolve its ids to the views mounted with them, in the order written") {
  ngn::AccessibilityRelations relations;
  relations.update(view(2, props("name")));
  relations.update(view(3, props("hint")));
  relations.update(view(4, props("", {"name", "missing"}, {"hint", "name"})));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{2}, {3, 2}}}});
  // Nothing changed since: nothing to tell.
  CHECK(relations.didMount(1).empty());
}

TEST_CASE("a relation follows the view it names as it is made, given another id and deleted") {
  ngn::AccessibilityRelations relations;
  relations.update(view(4, props("", {"name"})));
  // Named before any view has the id.
  CHECK(relations.didMount(1).empty());

  relations.update(view(2, props("name")));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{2}, {}}}});

  // Another id: the relation goes, and comes back to the view given the id after.
  relations.update(view(2, props("other")));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{}}});
  relations.update(view(5, props("name")));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{5}, {}}}});

  relations.remove(5);
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{}}});
}

TEST_CASE("a view that stops naming others has its relations cleared, and a deleted one is forgotten") {
  ngn::AccessibilityRelations relations;
  relations.update(view(2, props("name")));
  relations.update(view(4, props("", {}, {"name"})));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{}, {2}}}});

  relations.update(view(4, props("")));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{}}});

  relations.update(view(4, props("", {"name"})));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{2}, {}}}});
  // Deleted: its widget goes with what was set on it.
  relations.remove(4);
  relations.remove(2);
  CHECK(relations.didMount(1).empty());
}

TEST_CASE("an id names a view on the same surface only, the one made first where several have it") {
  ngn::AccessibilityRelations relations;
  relations.update(view(7, props("name"), 2));
  relations.update(view(4, props("", {"name"})));
  CHECK(relations.didMount(1).empty());
  CHECK(relations.didMount(2).empty());

  relations.update(view(6, props("name")));
  relations.update(view(3, props("name")));
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{3}, {}}}});
  relations.remove(3);
  CHECK(relations.didMount(1) == Changes{{4, AxRelations{{6}, {}}}});
}
