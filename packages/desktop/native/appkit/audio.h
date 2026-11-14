// The OS half of NgNativeAudio (the core's audio.h): AVPlayer for players, AVAudioRecorder for
// recorders. The input asks for the microphone only when the app's Info.plist has
// NSMicrophoneUsageDescription, and makes an AVAudioRecorder only once the core has checked the
// access, so a build without the string never shows a prompt.
#pragma once

#include "ngn/audio.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<AudioOutput> makeAudioOutput();
std::shared_ptr<AudioInput> makeAudioInput();

} // namespace ngn::appkit
