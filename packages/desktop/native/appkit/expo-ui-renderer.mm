#include "expo-ui-renderer.h"

#include <folly/json.h>

// expo-ui.swift's C interface.
extern "C" {
typedef void (*NGNUIEvent)(void *, int32_t, const char *, const char *);
typedef void *(*NGNUIViewForTag)(void *, int32_t);
void *ngn_ui_host_make(void *context, NGNUIEvent onEvent, NGNUIViewForTag viewForTag);
void ngn_ui_host_detach(void *host);
void ngn_ui_host_set_tree(void *host, const char *tree);
void ngn_ui_host_fit(void *host, double width, double height, double *outWidth, double *outHeight);
bool ngn_ui_host_perform(void *host, int32_t tag, const char *action);
bool ngn_ui_draws(const char *name);
}

namespace ngn::appkit {

namespace {

void onEvent(void *context, int32_t tag, const char *name, const char *payload) {
  static_cast<ExpoUIRenderer *>(context)->deliver(tag, name, payload);
}

void *onViewForTag(void *context, int32_t tag) {
  return (__bridge void *)static_cast<ExpoUIRenderer *>(context)->viewFor(tag);
}

} // namespace

ExpoUIRenderer::ExpoUIRenderer(Events events, Views views)
    : events_(std::move(events)), views_(std::move(views)), host_(ngn_ui_host_make(this, &onEvent, &onViewForTag)) {}

ExpoUIRenderer::~ExpoUIRenderer() {
  // The view can outlive the renderer in its superview for a moment: it calls back no more.
  ngn_ui_host_detach(host_);
  CFRelease(host_);
}

NSView *ExpoUIRenderer::view() const {
  return (__bridge NSView *)host_;
}

folly::dynamic ExpoUIRenderer::json(const ExpoUINode &node) {
  auto children = folly::dynamic::array();
  for (const auto &child : node.children) {
    children.push_back(json(child));
  }
  return folly::dynamic::object("tag", node.tag)("name", node.name)("props", node.props)("children", std::move(children));
}

void ExpoUIRenderer::setTree(std::shared_ptr<const ExpoUINode> root) {
  root_ = std::move(root);
  ngn_ui_host_set_tree(host_, root_ ? folly::toJson(json(*root_)).c_str() : "null");
}

facebook::react::Size ExpoUIRenderer::fit(double width, double height) const {
  double w = 0, h = 0;
  ngn_ui_host_fit(host_, width, height, &w, &h);
  return {static_cast<facebook::react::Float>(w), static_cast<facebook::react::Float>(h)};
}

bool ExpoUIRenderer::perform(facebook::react::Tag tag, const folly::dynamic &action) {
  return ngn_ui_host_perform(host_, tag, folly::toJson(action).c_str());
}

bool ExpoUIRenderer::draws(const std::string &name) {
  return ngn_ui_draws(name.c_str());
}

void ExpoUIRenderer::deliver(facebook::react::Tag tag, const std::string &name, const std::string &payload) {
  if (!events_) {
    return;
  }
  folly::dynamic parsed = folly::dynamic::object();
  try {
    parsed = folly::parseJson(payload);
  } catch (const std::exception &) {
  }
  events_(tag, name, std::move(parsed));
}

NSView *ExpoUIRenderer::viewFor(facebook::react::Tag tag) const {
  return views_ ? views_(tag) : nil;
}

std::unordered_map<facebook::react::Tag, facebook::react::SharedEventEmitter> expoUIEmitters(const ExpoUINode &root) {
  std::unordered_map<facebook::react::Tag, facebook::react::SharedEventEmitter> out;
  std::function<void(const ExpoUINode &)> walk = [&](const ExpoUINode &node) {
    if (node.eventEmitter) {
      out[node.tag] = node.eventEmitter;
    }
    for (const auto &child : node.children) {
      walk(child);
    }
  };
  walk(root);
  return out;
}

} // namespace ngn::appkit
