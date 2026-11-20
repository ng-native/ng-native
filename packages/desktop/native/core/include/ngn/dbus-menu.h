// A menu as the com.canonical.dbusmenu interface lays it out, for a Linux tray icon's menu
// (a StatusNotifierItem's): a tree under a root of id 0, each item numbered from 1 depth first, so a
// menu sent again keeps its numbers where its shape is the same. An item whose items are drawn in
// place (inlineItems) gives them to its parent between separators, as AppKit and GMenu sections draw
// them; a separator at either end, or beside another, is dropped.
#pragma once

#include "ngn/default-menu.h"

#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct DbusMenuNode {
  int id{0};
  // As dbusmenu shows it: an underscore marks a mnemonic, so the title's own are doubled.
  std::string label;
  bool separator{false};
  bool enabled{true};
  // A checked item is a checkmark toggle that is on; others are no toggle.
  bool checked{false};
  // The item the app knows (its MenuItem id), for a click to name; empty for a submenu or separator.
  std::string itemId;
  // The OS's command a click runs instead (a `menuRole` such as quit), or AppItem for the app's.
  MenuCommand command{MenuCommand::AppItem};
  std::vector<DbusMenuNode> children;
  bool operator==(const DbusMenuNode &) const = default;
};

// The root (id 0) holding `items`.
DbusMenuNode dbusMenuLayout(const std::vector<MenuItem> &items);
// The node numbered `id` under `root`, or null.
const DbusMenuNode *findDbusMenuNode(const DbusMenuNode &root, int id);
// A title with its underscores doubled.
std::string dbusMenuLabel(const std::string &title);

} // namespace ngn
