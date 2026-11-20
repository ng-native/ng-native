// React Native's cxx platform's paragraph props with the desktop props beside them
// (ngn/desktop-props.h), as a View's have them (ngn/desktop-view-props.h): a `<text>`'s
// `aria-level`, `aria-describedby`, ARIA states and counts, Tab order, cursor and context menu reach
// the core as a view's do. React Native's ParagraphProps is this class (ParagraphProps.h), so the
// shim's directory comes before the cxx platform's for every target (cmake/react-native.cmake).
#pragma once

#include <react/renderer/components/text/BaseParagraphProps.h>

#include "ngn/desktop-props.h"

namespace ngn {

// desktop-view-props.h's, declared here so React Native's own text sources need nothing more.
DesktopProps parseDesktopProps(
    const facebook::react::PropsParserContext &context,
    const DesktopProps &source,
    const facebook::react::RawProps &rawProps);

} // namespace ngn

namespace facebook::react {

class HostPlatformParagraphProps : public BaseParagraphProps, public ngn::HasDesktopProps {
 public:
  HostPlatformParagraphProps() = default;
  HostPlatformParagraphProps(
      const PropsParserContext &context,
      const HostPlatformParagraphProps &sourceProps,
      const RawProps &rawProps)
      : BaseParagraphProps(context, sourceProps, rawProps),
        ngn::HasDesktopProps{ngn::parseDesktopProps(context, sourceProps.desktop, rawProps)} {}
};

} // namespace facebook::react
