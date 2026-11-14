// An in-memory backend for the core tests: it records every call as a line of text and runs UI
// thread tasks only when a test drains them, so a test sees what reached the toolkit and when.
#pragma once

#include "ngn/desktop-view-props.h"
#include "ngn/mounting-backend.h"
#include "ngn/text-measurer.h"

#include <deque>
#include <functional>
#include <string>
#include <vector>

namespace ngn::testing {

class FakeBackend final : public MountingBackend, public DesktopPropsSink {
 public:
  void runOnUiThread(std::function<void()> task) override;
  void createView(const ShadowView &view) override;
  void deleteView(SurfaceId surfaceId, Tag tag) override;
  void insertChild(SurfaceId surfaceId, Tag parent, Tag child, int index) override;
  void removeChild(SurfaceId surfaceId, Tag parent, Tag child, int index) override;
  void updateProps(const ShadowView &view) override;
  void updateState(const ShadowView &view) override;
  void updateLayout(const ShadowView &view) override;
  void updateEventEmitter(const ShadowView &view) override;
  void dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &args) override;
  void setCovered(SurfaceId surfaceId, Tag tag, bool covered) override;
  void setFrontHeader(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header) override;
  void setPresented(SurfaceId surfaceId, Tag screen, bool presented) override;
  void setSplitView(SurfaceId surfaceId, Tag split, bool window) override;
  void setSourceLists(SurfaceId surfaceId, Tag parent, const std::vector<SourceList> &lists) override;
  void setSvgDrawing(SurfaceId surfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) override;
  void announce(SurfaceId surfaceId, const Announcement &announcement) override;
  void didMount(SurfaceId surfaceId) override;
  void updateDesktopProps(SurfaceId surfaceId, Tag tag, const DesktopProps &props) override;

  // Runs every queued UI thread task, including any a task queues. Returns how many ran.
  int drain();
  size_t pending() const {
    return tasks_.size();
  }

  std::vector<std::string> calls;

 private:
  std::deque<std::function<void()>> tasks_;
};

// Measures text as `charWidth` per UTF-8 byte on one line of `lineHeight`, and counts its calls.
class FakeTextMeasurer final : public TextMeasurer {
 public:
  facebook::react::Size measure(
      const facebook::react::AttributedString &text,
      const facebook::react::ParagraphAttributes &paragraph,
      facebook::react::Float maxWidth) const override;

  facebook::react::Float charWidth{7.3f};
  facebook::react::Float lineHeight{17.1f};
  mutable int calls{0};
};

} // namespace ngn::testing
