#include "ngn/focus-order.h"

#include "ngn/accessibility.h"
#include "ngn/desktop-props.h"
#include "ngn/native-controls.h"

#include <react/renderer/core/Props.h>

#include <algorithm>

using namespace facebook::react;

namespace ngn {

namespace {

struct Candidate {
  Tag tag;
  int tabIndex;
};

enum class Composite { TabList, RadioGroup, Menu, MenuBar, ListBox, Grid };

const DesktopProps *desktopOf(const ViewTree::Node &node) {
  const auto *holder = node.view.props ? dynamic_cast<const HasDesktopProps *>(node.view.props.get()) : nullptr;
  return holder != nullptr ? &holder->desktop : nullptr;
}

const ViewProps *viewPropsOf(const ViewTree::Node &node) {
  return node.view.props ? dynamic_cast<const ViewProps *>(node.view.props.get()) : nullptr;
}

std::string roleOf(const ViewTree::Node &node) {
  const auto *props = viewPropsOf(node);
  return props != nullptr ? roleName(*props) : std::string();
}

std::optional<Composite> compositeOf(const ViewTree::Node &node) {
  auto role = roleOf(node);
  if (role == "tablist") {
    return Composite::TabList;
  }
  if (role == "radiogroup") {
    return Composite::RadioGroup;
  }
  if (role == "menu") {
    return Composite::Menu;
  }
  if (role == "menubar") {
    return Composite::MenuBar;
  }
  if (role == "listbox") {
    return Composite::ListBox;
  }
  if (role == "grid") {
    return Composite::Grid;
  }
  return std::nullopt;
}

bool isItemOf(Composite composite, const std::string &role) {
  switch (composite) {
    case Composite::TabList:
      return role == "tab";
    case Composite::RadioGroup:
      return role == "radio";
    case Composite::Menu:
    case Composite::MenuBar:
      return role == "menuitem" || role == "menuitemcheckbox" || role == "menuitemradio";
    case Composite::ListBox:
      return role == "option";
    case Composite::Grid:
      return role == "gridcell" || role == "cell" || role == "columnheader" || role == "rowheader";
  }
  return false;
}

bool isTextInput(const ViewTree::Node &node) {
  return node.view.componentName == std::string_view("TextInput");
}

bool isControl(const ViewTree::Node &node) {
  std::string_view name = node.view.componentName;
  return controlKind(name).has_value() && name != std::string_view(ActivityIndicatorControlComponentName);
}

// Drawn and in this container: not covered, not hidden, not another container's content.
bool walked(const ViewTree &tree, Tag tag, Tag root, const ViewTree::Node *node) {
  return node != nullptr && !tree.covered(tag) && (tag == root || !tree.isContainerRoot(tag)) &&
      node->view.layoutMetrics.displayType != DisplayType::None;
}

} // namespace

bool viewTakesFocus(const DesktopProps &props) {
  return props.tabIndex.has_value() || props.focusable.value_or(false);
}

Tag focusContainer(const ViewTree &tree, Tag tag) {
  Tag at = tag;
  for (const auto *node = tree.find(at); node != nullptr; node = tree.find(at)) {
    if (tree.isContainerRoot(at) || node->parent < 0) {
      return at;
    }
    at = node->parent;
  }
  return tag;
}

namespace {

// Whether the view takes the focus when the host moves it there, in Tab order or not: any
// `tabIndex` does, as on the web.
bool canFocus(const ViewTree::Node &node) {
  const auto *desktop = desktopOf(node);
  if (desktop != nullptr && desktop->tabIndex) {
    return true;
  }
  auto focusable = desktop ? desktop->focusable : std::nullopt;
  return focusable.value_or(isTextInput(node) || isControl(node));
}

bool takesTab(const ViewTree::Node &node, TabReach reach) {
  const auto *desktop = desktopOf(node);
  auto tabIndex = desktop ? desktop->tabIndex : std::nullopt;
  auto focusable = desktop ? desktop->focusable : std::nullopt;
  bool textInput = isTextInput(node);
  bool takesFocus = tabIndex ? *tabIndex >= 0 : focusable.value_or(textInput || isControl(node));
  return takesFocus && (reach == TabReach::All || textInput);
}

int tabIndexOf(const ViewTree::Node &node) {
  const auto *desktop = desktopOf(node);
  return desktop && desktop->tabIndex ? *desktop->tabIndex : 0;
}

bool selectedOrChecked(const ViewTree::Node &node) {
  const auto *props = viewPropsOf(node);
  if (props == nullptr) {
    return false;
  }
  auto info = accessibilityInfo(*props);
  return info.selected || info.checked.value_or(0) == 1;
}

void collect(
    const ViewTree &tree,
    Tag tag,
    Tag root,
    TabReach reach,
    std::optional<Tag> focused,
    std::vector<Candidate> &out);

// Whether `tag`, or a view between it and the composite `composite` (an item wrapping the view
// that takes the focus), is selected or checked.
bool selectedIn(const ViewTree &tree, Tag tag, Tag composite) {
  for (auto on : tree.chain(tag, composite)) {
    if (on != composite && selectedOrChecked(*tree.find(on))) {
      return true;
    }
  }
  return false;
}

// Whether `tag`, under the composite `composite`, is drawn as collect walks: each view down to it
// shown, not covered and in this container.
bool drawnIn(const ViewTree &tree, Tag tag, Tag composite, Tag root) {
  auto path = tree.chain(tag, composite);
  return !path.empty() && std::all_of(path.begin(), path.end(), [&](Tag on) {
    return on == composite || walked(tree, on, root, tree.find(on));
  });
}

// A composite's Tab candidates become one stop: the focused view when it is in the composite, else
// its first selected or checked candidate, else its first. Text inputs keep their own. False when
// the composite has no stop.
bool collectComposite(
    const ViewTree &tree,
    Tag tag,
    Tag root,
    TabReach reach,
    std::optional<Tag> focused,
    std::vector<Candidate> &out) {
  std::vector<Candidate> inside;
  for (auto child : tree.find(tag)->children) {
    collect(tree, child, root, reach, focused, inside);
  }
  std::optional<Candidate> stop;
  bool focusedInside = false;
  if (focused && *focused != tag && drawnIn(tree, *focused, tag, root)) {
    const auto *node = tree.find(*focused);
    focusedInside = node != nullptr && reach == TabReach::All && canFocus(*node) && !isTextInput(*node);
    if (focusedInside) {
      stop = Candidate{*focused, tabIndexOf(*node)};
    }
  }
  for (const auto &c : inside) {
    if (!stop && selectedIn(tree, c.tag, tag) && !isTextInput(*tree.find(c.tag))) {
      stop = c;
    }
  }
  for (const auto &c : inside) {
    if (!stop && !isTextInput(*tree.find(c.tag))) {
      stop = c;
    }
  }
  bool placed = false;
  for (const auto &c : inside) {
    if (isTextInput(*tree.find(c.tag))) {
      out.push_back(c);
    } else if (!placed && stop) {
      out.push_back(*stop);
      placed = true;
    }
  }
  // The focused view was no candidate (a roving item with a tabIndex of -1): in its tree place.
  if (!placed && stop) {
    out.push_back(*stop);
  }
  return stop.has_value();
}

void collect(
    const ViewTree &tree,
    Tag tag,
    Tag root,
    TabReach reach,
    std::optional<Tag> focused,
    std::vector<Candidate> &out) {
  const auto *node = tree.find(tag);
  if (!walked(tree, tag, root, node)) {
    return;
  }
  if (compositeOf(*node)) {
    // One stop: an item's, or, with none, the composite's own when it takes the Tab.
    auto at = out.size();
    if (!collectComposite(tree, tag, root, reach, focused, out) && takesTab(*node, reach)) {
      out.insert(out.begin() + static_cast<std::ptrdiff_t>(at), {tag, tabIndexOf(*node)});
    }
    return;
  }
  if (takesTab(*node, reach)) {
    out.push_back({tag, tabIndexOf(*node)});
  }
  for (auto child : node->children) {
    collect(tree, child, root, reach, focused, out);
  }
}

// The view an item gives the focus to: itself, or the first view inside it that takes it.
std::optional<Tag> focusTarget(const ViewTree &tree, Tag tag, Tag root) {
  const auto *node = tree.find(tag);
  if (!walked(tree, tag, root, node)) {
    return std::nullopt;
  }
  if (canFocus(*node)) {
    return tag;
  }
  for (auto child : node->children) {
    if (auto found = focusTarget(tree, child, root)) {
      return found;
    }
  }
  return std::nullopt;
}

struct Item {
  Tag item;
  Tag target;
};

// The items of `composite` under `tag`, in tree order, outside nested composites. A grid's are
// gathered per row.
void collectItems(
    const ViewTree &tree,
    Tag tag,
    Tag root,
    Composite composite,
    std::vector<std::vector<Item>> &rows) {
  for (auto child : tree.find(tag)->children) {
    const auto *node = tree.find(child);
    if (!walked(tree, child, root, node) || compositeOf(*node)) {
      continue;
    }
    auto role = roleOf(*node);
    if (composite == Composite::Grid && role == "row") {
      rows.emplace_back();
      collectItems(tree, child, root, composite, rows);
      continue;
    }
    if (isItemOf(composite, role)) {
      const auto *props = viewPropsOf(*node);
      bool disabled = props != nullptr && accessibilityInfo(*props).disabled;
      auto target = focusTarget(tree, child, root);
      if (target && !(disabled && composite == Composite::RadioGroup)) {
        if (rows.empty()) {
          rows.emplace_back();
        }
        rows.back().push_back({child, *target});
      }
      continue;
    }
    collectItems(tree, child, root, composite, rows);
  }
}

} // namespace

std::optional<Tag> compositeMove(const ViewTree &tree, Tag root, Tag focused, CompositeKey key, bool control) {
  const auto *focusedNode = tree.find(focused);
  if (focusedNode == nullptr || isTextInput(*focusedNode) || isControl(*focusedNode)) {
    return std::nullopt;
  }
  auto path = tree.chain(focused, root);
  // The nearest composite around the focus (not the focus itself).
  std::optional<Composite> composite;
  Tag compositeTag = -1;
  for (size_t i = path.size(); i-- > 1;) {
    if (auto found = compositeOf(*tree.find(path[i - 1]))) {
      composite = found;
      compositeTag = path[i - 1];
      break;
    }
  }
  if (!composite) {
    return std::nullopt;
  }
  std::vector<std::vector<Item>> rows;
  collectItems(tree, compositeTag, root, *composite, rows);
  // Where the focus is: the item on its path.
  std::optional<std::pair<size_t, size_t>> at;
  for (size_t r = 0; r < rows.size() && !at; r++) {
    for (size_t c = 0; c < rows[r].size(); c++) {
      if (std::find(path.begin(), path.end(), rows[r][c].item) != path.end()) {
        at = {r, c};
        break;
      }
    }
  }
  if (!at) {
    return std::nullopt;
  }
  bool rtl = tree.find(compositeTag)->view.layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  if (rtl && (key == CompositeKey::Left || key == CompositeKey::Right)) {
    key = key == CompositeKey::Left ? CompositeKey::Right : CompositeKey::Left;
  }
  auto [row, col] = *at;

  if (*composite == Composite::Grid) {
    const auto &cells = rows[row];
    switch (key) {
      case CompositeKey::Left:
        col = col > 0 ? col - 1 : col;
        break;
      case CompositeKey::Right:
        col = col + 1 < cells.size() ? col + 1 : col;
        break;
      case CompositeKey::Up:
      case CompositeKey::Down: {
        // The next row with a cell, in the same column or the row's last when it is shorter.
        size_t r = row;
        while (key == CompositeKey::Up ? r > 0 : r + 1 < rows.size()) {
          r = key == CompositeKey::Up ? r - 1 : r + 1;
          if (!rows[r].empty()) {
            row = r;
            col = std::min(col, rows[r].size() - 1);
            break;
          }
        }
        break;
      }
      case CompositeKey::Home:
        if (control) {
          for (row = 0; rows[row].empty(); row++) {
          }
        }
        col = 0;
        break;
      case CompositeKey::End:
        if (control) {
          for (row = rows.size() - 1; rows[row].empty(); row--) {
          }
        }
        col = rows[row].size() - 1;
        break;
    }
    return rows[row][col].target;
  }

  const auto &items = rows.front();
  size_t size = items.size();
  enum class Step { None, Back, Forward } step = Step::None;
  bool wraps = *composite != Composite::ListBox;
  switch (key) {
    case CompositeKey::Home:
      return items.front().target;
    case CompositeKey::End:
      return items.back().target;
    case CompositeKey::Left:
    case CompositeKey::Right:
      if (*composite == Composite::TabList || *composite == Composite::RadioGroup ||
          *composite == Composite::MenuBar) {
        step = key == CompositeKey::Left ? Step::Back : Step::Forward;
      }
      break;
    case CompositeKey::Up:
    case CompositeKey::Down:
      if (*composite != Composite::MenuBar) {
        step = key == CompositeKey::Up ? Step::Back : Step::Forward;
      }
      break;
  }
  if (step == Step::None) {
    return std::nullopt;
  }
  if (step == Step::Back) {
    return col > 0 ? items[col - 1].target : wraps ? items.back().target : items[col].target;
  }
  return col + 1 < size ? items[col + 1].target : wraps ? items.front().target : items[col].target;
}

std::vector<Tag> tabOrder(const ViewTree &tree, Tag root, TabReach reach, std::optional<Tag> focused) {
  std::vector<Candidate> found;
  collect(tree, root, root, reach, focused, found);
  // Positive tabIndex first, lowest first; the rest keep tree order.
  std::stable_sort(found.begin(), found.end(), [](const Candidate &a, const Candidate &b) {
    bool aExplicit = a.tabIndex > 0, bExplicit = b.tabIndex > 0;
    if (aExplicit != bExplicit) {
      return aExplicit;
    }
    return aExplicit && a.tabIndex < b.tabIndex;
  });
  std::vector<Tag> order;
  order.reserve(found.size());
  for (const auto &c : found) {
    order.push_back(c.tag);
  }
  return order;
}

std::optional<Tag> nextInTabOrder(
    const ViewTree &tree,
    Tag root,
    std::optional<Tag> from,
    bool backwards,
    TabReach reach) {
  auto order = tabOrder(tree, root, reach, from);
  if (order.empty()) {
    return std::nullopt;
  }
  auto at = from ? std::find(order.begin(), order.end(), *from) : order.end();
  if (at == order.end()) {
    return backwards ? order.back() : order.front();
  }
  auto index = static_cast<size_t>(at - order.begin());
  auto size = order.size();
  return order[backwards ? (index + size - 1) % size : (index + 1) % size];
}

} // namespace ngn
