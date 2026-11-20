---
__default__: patch
---

On the GTK desktop host on Linux, `<expo-camera>`, `Camera` and `ImagePicker`'s camera work through the Camera portal, PipeWire and GStreamer 1.22 or later, with GStreamer's PipeWire plugin installed.

Access is the portal's `AccessCamera`, and whether there is a camera is its `IsCameraPresent`. A picture is the newest frame, as a JPEG or PNG. A recording is a QuickTime movie, H.264 where an x264 or OpenH264 encoder and `h264parse` are installed and Motion JPEG otherwise, with AAC sound where an AAC encoder is installed, the view is not muted and a microphone is present: PipeWire records silence with no error when there is none, so a recording without a microphone has no sound track. A camera starts off the main loop, and one whose stream fails after it started sends `mountError`. `facing` and `mirror` do nothing, since the portal offers the cameras as one. `ImagePicker.launchCameraAsync` shows a camera window over the app's front window with the preview, Cancel (or Escape) and the shutter, which waits for the camera's first frame, and a Photo and Video switch when both are asked for; a recording cancelled there leaves no file.
