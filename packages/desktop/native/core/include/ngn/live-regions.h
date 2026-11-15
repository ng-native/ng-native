// Live regions (`accessibilityLiveRegion`, `aria-live`): what each one says when its text
// changes, as Android and the web announce it. AppKit has no live-region property a native view can
// set, so the host announces the region's new text itself.
//
// A region says nothing as it appears, nor when its text empties; after that, each transaction
// that leaves it with other text than before announces that text, politely for `polite` and
// interrupting for `assertive`. Its text is its label when it has one, otherwise the text of the
// views under it in tree order, each one's label or its paragraph's string, leaving out hidden
// ones.
#pragma once

#include "ngn/system.h"
#include "ngn/view-tree.h"

#include <functional>
#include <map>
#include <string>
#include <vector>

namespace ngn {

class LiveRegions {
 public:
  // The text a view holds itself: a paragraph's string, empty for anything else.
  using TextOf = std::function<std::string(const ShadowView &)>;

  explicit LiveRegions(const ViewTree &tree, TextOf textOf);

  // A view was created or its props changed: it may have become a region or stopped being one.
  void update(const ShadowView &view);
  void remove(Tag tag);

  // After a transaction on `surfaceId`: what its regions whose text changed say.
  std::vector<Announcement> didMount(SurfaceId surfaceId);

 private:
  struct Region {
    SurfaceId surfaceId;
    AnnouncementPriority priority;
    std::string text;
    // Not yet read: its first text is what it holds, not news.
    bool fresh{true};
  };
  std::string textOf(Tag tag) const;
  void collect(Tag tag, std::string &out) const;

  const ViewTree &tree_;
  TextOf textOf_;
  std::map<Tag, Region> regions_;
};

} // namespace ngn
