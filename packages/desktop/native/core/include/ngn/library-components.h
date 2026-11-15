// The Fabric components of the libraries compiled into this host (cmake/libraries.cmake generates
// the definition from the build's NGN_LIBRARIES). Empty when the build names no library.
#pragma once

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>

#include <vector>

namespace ngn {

std::vector<facebook::react::ComponentDescriptorProvider> libraryComponents();

} // namespace ngn
