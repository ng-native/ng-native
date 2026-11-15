#include "helpers.h"
#include "ngn/live-regions.h"

#include <doctest/doctest.h>

#include <map>

using namespace facebook::react;
using ngn::Announcement;
using ngn::AnnouncementPriority;
using ngn::testing::shadowView;

namespace {

std::shared_ptr<const ViewProps> props(
    AccessibilityLiveRegion live = AccessibilityLiveRegion::None,
    std::string label = "",
    bool hidden = false) {
  auto p = std::make_shared<ViewProps>();
  p->accessibilityLiveRegion = live;
  p->accessibilityLabel = std::move(label);
  p->accessibilityElementsHidden = hidden;
  return p;
}

// A region (2) holding two paragraphs (3, 4), and a plain view (5) with a paragraph (6), under the
// surface's root (1). A paragraph's text is what `texts` says.
struct Fixture {
  ngn::ViewTree tree;
  std::map<Tag, std::string> texts{{3, "3 new"}, {4, "messages"}, {6, "elsewhere"}};
  ngn::LiveRegions regions{tree, [this](const ShadowView &view) {
                             auto it = texts.find(view.tag);
                             return it == texts.end() ? std::string() : it->second;
                           }};

  Fixture() {
    add(1, -1, "View", props());
    add(2, 1, "View", props(AccessibilityLiveRegion::Polite));
    add(3, 2, "Paragraph", props());
    add(4, 2, "Paragraph", props());
    add(5, 1, "View", props());
    add(6, 5, "Paragraph", props());
  }

  void add(Tag tag, Tag parent, const char *component, Props::Shared p) {
    auto view = shadowView(tag, component, {{0, 0}, {10, 10}}, std::move(p));
    tree.create(view);
    regions.update(view);
    if (parent != -1) {
      tree.insert(parent, tag, static_cast<int>(tree.find(parent)->children.size()));
    }
  }

  void setProps(Tag tag, Props::Shared p) {
    auto view = tree.find(tag)->view;
    view.props = std::move(p);
    tree.update(view);
    regions.update(view);
  }
};

using Said = std::vector<Announcement>;

} // namespace

TEST_CASE("a live region says nothing as it appears, then its text each time it changes") {
  Fixture f;
  CHECK(f.regions.didMount(1).empty());
  CHECK(f.regions.didMount(1).empty());

  f.texts[3] = "4 new";
  CHECK(f.regions.didMount(1) == Said{{"4 new messages", AnnouncementPriority::Medium}});
  // The same text again says nothing; a change elsewhere in the window says nothing.
  f.texts[6] = "changed";
  CHECK(f.regions.didMount(1).empty());
}

TEST_CASE("an assertive region interrupts, and a label speaks for the region's text") {
  Fixture f;
  f.regions.didMount(1);
  f.setProps(2, props(AccessibilityLiveRegion::Assertive, "Upload 40%"));
  CHECK(f.regions.didMount(1) == Said{{"Upload 40%", AnnouncementPriority::High}});
  f.setProps(4, props(AccessibilityLiveRegion::None, "", true));
  f.setProps(2, props(AccessibilityLiveRegion::Assertive));
  // Hidden text is not read.
  CHECK(f.regions.didMount(1) == Said{{"3 new", AnnouncementPriority::High}});
}

TEST_CASE("a region that stops being one, or goes, is forgotten, and an emptied one says nothing") {
  Fixture f;
  f.regions.didMount(1);
  f.texts[3] = "";
  f.texts[4] = "";
  CHECK(f.regions.didMount(1).empty());

  f.setProps(2, props());
  f.texts[3] = "back";
  CHECK(f.regions.didMount(1).empty());

  // A region again starts from what it holds then.
  f.setProps(2, props(AccessibilityLiveRegion::Polite));
  CHECK(f.regions.didMount(1).empty());
  f.texts[4] = "again";
  CHECK(f.regions.didMount(1) == Said{{"back again", AnnouncementPriority::Medium}});

  f.tree.remove(1, 2);
  f.tree.destroy(2);
  f.regions.remove(2);
  CHECK(f.regions.didMount(1).empty());
}

TEST_CASE("a region on another surface is announced after that surface's transaction") {
  Fixture f;
  auto other = shadowView(11, "View", {{0, 0}, {10, 10}}, props(AccessibilityLiveRegion::Polite, "one"));
  other.surfaceId = 11;
  f.tree.create(other);
  f.regions.update(other);
  f.regions.didMount(11);
  other.props = props(AccessibilityLiveRegion::Polite, "two");
  f.tree.update(other);
  f.regions.update(other);
  CHECK(f.regions.didMount(1).empty());
  CHECK(f.regions.didMount(11) == Said{{"two", AnnouncementPriority::Medium}});
}
