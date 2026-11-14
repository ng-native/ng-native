// The mounting interface: what the core asks of a toolkit to show a surface's views.
//
// The core replays every mounting transaction as these calls, in the transaction's order, on the
// toolkit's UI thread. The surface's root view (tag == surfaceId) arrives as a createView like any
// other; the backend attaches it to the surface's main container.
#pragma once

#include "ngn/screen-stacks.h"
#include "ngn/split-view.h"
#include "ngn/svg.h"

#include <react/renderer/core/ComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/mounting/ShadowView.h>

#include <folly/dynamic.h>
#include <functional>
#include <string>
#include <vector>

namespace ngn {

using facebook::react::ShadowView;
using facebook::react::SurfaceId;
using facebook::react::Tag;

class MountingBackend {
 public:
  virtual ~MountingBackend() = default;

  // Runs `task` on the toolkit's UI thread, after every task posted before it.
  virtual void runOnUiThread(std::function<void()> task) = 0;

  // A view for `view.tag`, with its first props, state, layout and event emitter already set on
  // `view`. The update calls below then report only what changed.
  virtual void createView(const ShadowView &view) = 0;
  virtual void deleteView(SurfaceId surfaceId, Tag tag) = 0;
  virtual void insertChild(SurfaceId surfaceId, Tag parent, Tag child, int index) = 0;
  virtual void removeChild(SurfaceId surfaceId, Tag parent, Tag child, int index) = 0;

  virtual void updateProps(const ShadowView &view) = 0;
  virtual void updateState(const ShadowView &view) = 0;
  virtual void updateLayout(const ShadowView &view) = 0;
  virtual void updateEventEmitter(const ShadowView &view) = 0;

  virtual void dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &args) = 0;

  // A screen below the top of its stack (screen-stacks.h): hidden without being unmounted, and
  // shown again as it returns to the top.
  virtual void setCovered(SurfaceId /*surfaceId*/, Tag /*tag*/, bool /*covered*/) {}

  // A screen came to be presented over its stack (screen-presentation.h) or went back to being
  // pushed. It is a sheet, cover or popover as its desktop props say, presented like a modal.
  virtual void setPresented(SurfaceId /*surfaceId*/, Tag /*screen*/, bool /*presented*/) {}

  // The header the surface's main container shows changed: another screen came to the front, or
  // its stack gained or lost the screen below it. Nothing when no screen in front has a header.
  virtual void setFrontHeader(SurfaceId /*surfaceId*/, const std::optional<ScreenStacks::FrontHeader> & /*header*/) {}

  // A split view mounted (split-view.h): the window's own, or a plain one in the content. Sent once,
  // after its panes are in it.
  virtual void setSplitView(SurfaceId /*surfaceId*/, Tag /*split*/, bool /*window*/) {}

  // The source lists among `parent`'s children changed: their sections, rows or rows' props. Empty
  // when the last of them went.
  virtual void setSourceLists(SurfaceId /*surfaceId*/, Tag /*parent*/, const std::vector<SourceList> & /*lists*/) {}

  // An svg's elements changed (svg.h): its view draws `document` from now on.
  virtual void setSvgDrawing(SurfaceId /*surfaceId*/, Tag /*svg*/, std::shared_ptr<const SvgDocument> /*document*/) {}

  // Called once a transaction's mutations have all been applied.
  virtual void didMount(SurfaceId /*surfaceId*/) {}

  // Components the toolkit draws beyond the core's own (View, Paragraph, Text, RawText,
  // ScrollView, TextInput, Image, ModalHostView, the native controls of native-controls.h and
  // UnimplementedNativeView).
  virtual std::vector<facebook::react::ComponentDescriptorProvider> componentProviders() const {
    return {};
  }
};

} // namespace ngn
