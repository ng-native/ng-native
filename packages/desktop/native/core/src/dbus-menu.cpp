#include "ngn/dbus-menu.h"

namespace ngn {

namespace {

void addSeparator(std::vector<DbusMenuNode> &into, int &next) {
  if (!into.empty() && !into.back().separator) {
    into.push_back({.id = next++, .separator = true});
  }
}

void addItems(const std::vector<MenuItem> &items, std::vector<DbusMenuNode> &into, int &next) {
  for (const auto &item : items) {
    if (item.separator) {
      addSeparator(into, next);
    } else if (item.inlineItems) {
      addSeparator(into, next);
      addItems(item.items, into, next);
      addSeparator(into, next);
    } else {
      DbusMenuNode node{
          .id = next++,
          .label = dbusMenuLabel(item.title),
          .enabled = !item.disabled,
          .checked = item.checked,
          .itemId = item.items.empty() ? item.id : std::string(),
          .command = item.items.empty() && item.command != MenuCommand::None ? item.command : MenuCommand::AppItem,
          .svgIcon = item.svgIcon,
      };
      addItems(item.items, node.children, next);
      into.push_back(std::move(node));
    }
  }
  if (!into.empty() && into.back().separator) {
    into.pop_back();
  }
}

} // namespace

DbusMenuNode dbusMenuLayout(const std::vector<MenuItem> &items) {
  DbusMenuNode root;
  int next = 1;
  addItems(items, root.children, next);
  return root;
}

const DbusMenuNode *findDbusMenuNode(const DbusMenuNode &root, int id) {
  if (root.id == id) {
    return &root;
  }
  for (const auto &child : root.children) {
    if (const auto *found = findDbusMenuNode(child, id)) {
      return found;
    }
  }
  return nullptr;
}

std::string dbusMenuLabel(const std::string &title) {
  std::string out;
  for (char c : title) {
    out += c;
    if (c == '_') {
      out += '_';
    }
  }
  return out;
}

} // namespace ngn
