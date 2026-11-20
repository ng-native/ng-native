// The views a view is labelled and described by: `accessibilityLabelledBy` (`aria-labelledby`) and
// `accessibilityDescribedBy` (`aria-describedby`), each a list of `nativeID`s. The core resolves the
// ids to the views mounted with them on the same surface, in the order written, and the backend
// points its toolkit's relations at their views (labelled-by and described-by on GTK, the title
// element and the help on AppKit). An id no view has is left out; one that several views have
// names the one with the lowest tag (Fabric counts tags up as views are made, so the one made first).
//
// A relation follows both of its ends: a view gaining or losing the props, and a view named by
// them being made, deleted or given another id. Kept by the mounting manager, which tells the
// backend after each transaction which views' relations changed.
#pragma once

#include "ngn/view-tree.h"

#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace ngn {

struct AxRelations {
  std::vector<Tag> labelledBy;
  std::vector<Tag> describedBy;

  bool empty() const {
    return labelledBy.empty() && describedBy.empty();
  }
  bool operator==(const AxRelations &) const = default;
};

class AccessibilityRelations {
 public:
  // A view was created or its props changed: its own ids, and the ids it names.
  void update(const ShadowView &view);
  // A view was deleted.
  void remove(Tag tag);

  // After a transaction on `surfaceId`: each view whose relations changed, with what they are now,
  // empty for one that lost them.
  std::vector<std::pair<Tag, AxRelations>> didMount(SurfaceId surfaceId);

 private:
  struct Names {
    SurfaceId surfaceId{-1};
    std::vector<std::string> labelledBy;
    std::vector<std::string> describedBy;
  };
  std::vector<Tag> resolve(SurfaceId surfaceId, const std::vector<std::string> &ids) const;
  void forgetId(Tag tag);

  // Each surface's ids, with the views that have each.
  std::map<SurfaceId, std::map<std::string, std::set<Tag>>> ids_;
  // Each view's id, to take it out of ids_ as it changes or goes.
  std::map<Tag, std::pair<SurfaceId, std::string>> idOf_;
  // The views that name others.
  std::map<Tag, Names> naming_;
  // What each view's relations were last reported as, while not empty, and its surface.
  std::map<Tag, std::pair<SurfaceId, AxRelations>> reported_;
  // The surfaces a change since their last transaction may have touched.
  std::set<SurfaceId> dirty_;
};

} // namespace ngn
