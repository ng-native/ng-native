import ExpoModulesCore
import ImageIO
import Vision

enum TextRecognitionLevel: String, Enumerable {
  case accurate
  case fast
}

/// What `recognize()` was given.
struct TextRecognitionOptions: Record {
  /// BCP 47 codes, most likely first. Left out, Vision detects the language.
  @Field var languages: [String]?
  @Field var level: TextRecognitionLevel = .accurate
}

/**
 The text in an image, from Vision's `VNRecognizeTextRequest`, line by line with each line's
 confidence and box. It runs on the device, offline, and does not need Apple Intelligence.

 A box is in the image's pixels from its top left corner, the right way up: the orientation the
 file records is applied before Vision reads it, and Vision's boxes, which are fractions of the
 image from its bottom left corner, are converted.
 */
public final class TextRecognitionModule: Module {
  /// Expo runs an async function on one serial queue shared by every module unless told
  /// otherwise, so decoding and reading an image here would hold up their calls.
  private let queue = DispatchQueue(label: "ng-native.text-recognition", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("NgNativeTextRecognition")

    AsyncFunction("recognize") { (uri: String, options: TextRecognitionOptions, promise: Promise) in
      guard let image = Self.image(at: uri) else {
        promise.reject("ERR_IMAGE_LOAD", "No image could be read at \(uri)")
        return
      }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = options.level == .fast ? .fast : .accurate
      if let languages = options.languages, !languages.isEmpty {
        // Vision ignores a code it does not list, so one it cannot read is refused here.
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        let resolved = languages.map { Self.language($0, in: supported) }
        let unsupported = zip(languages, resolved).filter { $0.1 == nil }.map { $0.0 }
        if !unsupported.isEmpty {
          promise.reject(
            "ERR_TEXT_RECOGNITION",
            "Vision cannot read \(unsupported.joined(separator: ", ")) at this level. It can read "
              + supported.joined(separator: ", "))
          return
        }
        request.recognitionLanguages = resolved.compactMap { $0 }
      } else if #available(iOS 16.0, *) {
        request.automaticallyDetectsLanguage = true
      }
      do {
        try VNImageRequestHandler(cgImage: image.cgImage, orientation: image.orientation)
          .perform([request])
      } catch {
        promise.reject("ERR_TEXT_RECOGNITION", error.localizedDescription)
        return
      }
      let size = image.uprightSize
      var texts: [String] = []
      var lines: [[String: Any]] = []
      for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        texts.append(candidate.string)
        let box = VNImageRectForNormalizedRect(
          observation.boundingBox, Int(size.width), Int(size.height))
        lines.append([
          "text": candidate.string,
          "confidence": Double(candidate.confidence),
          "box": [
            "x": box.minX,
            "y": size.height - box.maxY,
            "width": box.width,
            "height": box.height,
          ],
        ])
      }
      promise.resolve([
        "text": texts.joined(separator: "\n"),
        "lines": lines,
        "width": size.width,
        "height": size.height,
      ])
    }.runOnQueue(queue)
  }

  /// The code Vision lists for `code`: itself, or else the first with the same language, so
  /// `en-GB` reads as `en-US`. Nil when Vision reads no variant of the language.
  private static func language(_ code: String, in supported: [String]) -> String? {
    if supported.contains(code) { return code }
    let wanted = primary(code)
    return supported.first { primary($0) == wanted }
  }

  private static func primary(_ code: String) -> String {
    String(code.split(separator: "-").first ?? Substring(code)).lowercased()
  }

  private struct OrientedImage {
    let cgImage: CGImage
    let orientation: CGImagePropertyOrientation

    /// The pixel size once the orientation is applied: a quarter turn swaps the sides.
    var uprightSize: CGSize {
      let width = CGFloat(cgImage.width)
      let height = CGFloat(cgImage.height)
      switch orientation {
      case .left, .leftMirrored, .right, .rightMirrored:
        return CGSize(width: height, height: width)
      default:
        return CGSize(width: width, height: height)
      }
    }
  }

  /// The first image in the file a `file://` URI, or a plain path, names.
  private static func image(at uri: String) -> OrientedImage? {
    let url: URL
    if let parsed = URL(string: uri), parsed.scheme != nil {
      guard parsed.isFileURL else { return nil }
      url = parsed
    } else {
      url = URL(fileURLWithPath: uri)
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return nil }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let raw = (properties?[kCGImagePropertyOrientation] as? UInt32) ?? 1
    return OrientedImage(
      cgImage: cgImage, orientation: CGImagePropertyOrientation(rawValue: raw) ?? .up)
  }
}
