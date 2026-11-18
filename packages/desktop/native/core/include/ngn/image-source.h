// Which of an Image's sources it loads, and whether a new one is a new load: the same on every
// toolkit, which then makes the request (appkit/image-request.h on macOS, loadImageSource below
// on the others).
#pragma once

#include "ngn/expo-image.h"
#include "ngn/file-system.h"
#include "ngn/network.h"

#include <react/renderer/imagemanager/primitives.h>

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

// The source with a uri whose scale is nearest `screenScale`, as React Native iOS picks, or none.
std::optional<facebook::react::ImageSource> pickImageSource(
    const std::vector<facebook::react::ImageSource> &sources, double screenScale);
// Whether two sources load the same thing: ImageSource's own == compares only the uri.
bool sameImageRequest(const facebook::react::ImageSource &a, const facebook::react::ImageSource &b);

// An Image's resizeMode as a CSS object-fit for placeImage (expo-image.h), as the macOS host's layer
// gravity draws it: `center` centres the image at its own size, and `repeat` stretches it.
const char *imageContentFit(facebook::react::ImageResizeMode mode);

// Reads an Image source's bytes with its method, headers and body, as the macOS host's request
// does. Its `cache` is read as React Native iOS maps it to a cache policy, over `cache` (kept in
// memory) in place of the system's URL cache: `default` and `force-cache` answer from it when it
// holds the source, `reload` fetches again, and `only-if-cached` fails when it does not. Only a GET
// over http(s) with no body is cached. `file:` and `data:` sources are read, a file only inside the
// boundary `files` draws (readableSource). Answers once, on any thread: the bytes, or an error.
void loadImageSource(
    const std::shared_ptr<Http> &http,
    const std::shared_ptr<ImageCache> &cache,
    const FileAccess *files,
    const facebook::react::ImageSource &source,
    std::function<void(std::string bytes, const std::string &error)> done);

} // namespace ngn
