// @react-native-masked-view/masked-view's view on a desktop host, under its own Fabric name, so the
// library needs no desktop code of its own: `<gradient-text>` and any app that commits the view.
//
// The view draws its children through its first child: where the first child is opaque, the rest
// show, and the first child itself is not drawn, as React Native's iOS view takes it out of the
// hierarchy to be the mask. The backend does the masking: a layer mask on macOS, a snapshot mask
// on GTK.
#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace ngn {

extern const char MaskedViewComponentName[];

using MaskedViewShadowNode = facebook::react::
    ConcreteViewShadowNode<MaskedViewComponentName, facebook::react::ViewProps, facebook::react::ViewEventEmitter>;
using MaskedViewComponentDescriptor = facebook::react::ConcreteComponentDescriptor<MaskedViewShadowNode>;

} // namespace ngn
