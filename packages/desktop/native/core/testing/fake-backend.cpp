#include "fake-backend.h"

#include <algorithm>
#include <string>

namespace ngn::testing {

namespace {

std::string frame(const ShadowView &view) {
  const auto &f = view.layoutMetrics.frame;
  auto n = [](float v) {
    auto s = std::to_string(v);
    s.erase(s.find_last_not_of('0') + 1);
    if (s.back() == '.') {
      s.pop_back();
    }
    return s;
  };
  return n(f.origin.x) + "," + n(f.origin.y) + " " + n(f.size.width) + "x" + n(f.size.height);
}

std::string optional(const auto &value) {
  return value ? std::to_string(*value) : "unset";
}

} // namespace

void FakeBackend::runOnUiThread(std::function<void()> task) {
  tasks_.push_back(std::move(task));
}

int FakeBackend::drain() {
  int ran = 0;
  while (!tasks_.empty()) {
    auto task = std::move(tasks_.front());
    tasks_.pop_front();
    task();
    ran++;
  }
  return ran;
}

void FakeBackend::createView(const ShadowView &view) {
  calls.push_back("create " + std::to_string(view.tag) + " " + view.componentName + " " + frame(view));
}

void FakeBackend::deleteView(SurfaceId, Tag tag) {
  calls.push_back("delete " + std::to_string(tag));
}

void FakeBackend::insertChild(SurfaceId, Tag parent, Tag child, int index) {
  calls.push_back("insert " + std::to_string(child) + " into " + std::to_string(parent) + " at " + std::to_string(index));
}

void FakeBackend::removeChild(SurfaceId, Tag parent, Tag child, int index) {
  calls.push_back("remove " + std::to_string(child) + " from " + std::to_string(parent) + " at " + std::to_string(index));
}

void FakeBackend::updateProps(const ShadowView &view) {
  props[view.tag] = view.props;
  calls.push_back("props " + std::to_string(view.tag));
}

void FakeBackend::updateState(const ShadowView &view) {
  calls.push_back("state " + std::to_string(view.tag));
}

void FakeBackend::updateLayout(const ShadowView &view) {
  calls.push_back("layout " + std::to_string(view.tag) + " " + frame(view));
}

void FakeBackend::updateEventEmitter(const ShadowView &view) {
  calls.push_back("emitter " + std::to_string(view.tag));
}

void FakeBackend::dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &) {
  calls.push_back("command " + std::to_string(tag) + " " + name);
}

void FakeBackend::setCovered(SurfaceId, Tag tag, bool covered) {
  calls.push_back((covered ? "cover " : "uncover ") + std::to_string(tag));
}

void FakeBackend::setFrontHeader(SurfaceId, const std::optional<ScreenStacks::FrontHeader> &header) {
  calls.push_back(
      header ? "header " + std::to_string(header->config) + " of " + std::to_string(header->screen) +
              (header->canGoBack ? " with back" : "")
             : "no header");
}

void FakeBackend::setPresented(SurfaceId, Tag screen, bool presented) {
  calls.push_back((presented ? "present " : "unpresent ") + std::to_string(screen));
}

void FakeBackend::setSplitView(SurfaceId, Tag split, bool window) {
  calls.push_back("split view " + std::to_string(split) + (window ? " of the window" : " in the content"));
}

// "lists of 3: [4 Mail: 5 Inbox (3) *, 6 custom] [9: 10 Sent]": a list per run of sections, each
// section's tag and title, then each row's tag, label, badge, selected (*) and custom.
void FakeBackend::setSvgDrawing(SurfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) {
  calls.push_back("svg " + std::to_string(svg) + " with " + std::to_string(document->root.children.size()));
}

void FakeBackend::setSourceLists(SurfaceId, Tag parent, const std::vector<SourceList> &lists) {
  std::string line = "lists of " + std::to_string(parent) + ":";
  for (const auto &list : lists) {
    line += " [";
    for (size_t g = 0; g < list.groups.size(); g++) {
      const auto &group = list.groups[g];
      line += (g > 0 ? " | " : "") + std::to_string(group.tag) + (group.title.empty() ? "" : " " + group.title) +
          (group.collapsible ? " (collapsible)" : "") + ":";
      for (size_t r = 0; r < group.rows.size(); r++) {
        const auto &row = group.rows[r];
        line += (r > 0 ? ", " : " ") + std::to_string(row.tag);
        if (!row.label.empty()) {
          line += " " + row.label;
        }
        if (!row.badge.empty()) {
          line += " (" + row.badge + ")";
        }
        if (!row.sfSymbol.empty()) {
          line += " <" + row.sfSymbol + ">";
        }
        if (row.selected) {
          line += " *";
        }
        if (row.custom) {
          line += " custom";
        }
      }
    }
    line += "]";
  }
  calls.push_back(line);
}

void FakeBackend::announce(SurfaceId surfaceId, const Announcement &announcement) {
  const char *names[] = {"low", "medium", "high"};
  calls.push_back(
      "announce " + std::to_string(surfaceId) + " " + names[static_cast<int>(announcement.priority)] + " " +
      announcement.text);
}

void FakeBackend::didMount(SurfaceId surfaceId) {
  calls.push_back("mounted " + std::to_string(surfaceId));
}

void FakeBackend::updateDesktopProps(SurfaceId, Tag tag, const DesktopProps &props) {
  std::string focusable = props.focusable ? (*props.focusable ? "true" : "false") : "unset";
  calls.push_back(
      "desktop " + std::to_string(tag) + " focusable=" + focusable + " tabIndex=" + optional(props.tabIndex));
}

facebook::react::Size FakeTextMeasurer::measure(
    const facebook::react::AttributedString &text,
    const facebook::react::ParagraphAttributes &,
    facebook::react::Float maxWidth) const {
  calls++;
  auto width = charWidth * static_cast<facebook::react::Float>(text.getString().size());
  // As Core Text lays it out: an empty string has no line, so no height.
  return {std::min(width, maxWidth), text.getString().empty() ? 0 : lineHeight};
}

} // namespace ngn::testing
