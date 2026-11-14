#include "NgNativeSplitViewShadowNodes.h"

#import <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char NgNativeSplitViewComponentName[] = "NgNativeSplitView";
extern const char NgNativeSidebarComponentName[] = "NgNativeSidebar";
extern const char NgNativeSplitContentComponentName[] = "NgNativeSplitContent";

NgNativeSidebarProps::NgNativeSidebarProps(
    const PropsParserContext &context,
    const NgNativeSidebarProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      collapsed(convertRawProp(context, rawProps, "collapsed", sourceProps.collapsed, false)),
      paneMinWidth(convertRawProp(context, rawProps, "paneMinWidth", sourceProps.paneMinWidth, (Float)0)),
      paneMaxWidth(convertRawProp(context, rawProps, "paneMaxWidth", sourceProps.paneMaxWidth, (Float)0))
{
}

void NgNativeSidebarEventEmitter::onSidebarCollapse(bool collapsed) const
{
  dispatchEvent("sidebarCollapse", [collapsed](jsi::Runtime &runtime) {
    auto payload = jsi::Object(runtime);
    payload.setProperty(runtime, "collapsed", collapsed);
    return payload;
  });
}

} // namespace facebook::react
