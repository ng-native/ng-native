import ExpoModulesCore
import ImageIO
import Vision
import VisionKit

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
      do {
        promise.resolve(try Self.read(image, options))
      } catch let failure as ReadFailure {
        promise.reject(failure.code, failure.message)
      } catch {
        promise.reject("ERR_TEXT_RECOGNITION", error.localizedDescription)
      }
    }.runOnQueue(queue)

    /// The simulator, and an iPad or iPhone without a camera, have no document camera.
    Function("scannerAvailable") { VNDocumentCameraViewController.isSupported }

    AsyncFunction("scanDocument") { (options: TextRecognitionOptions, promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject("ERR_SCANNER_UNAVAILABLE", "This device has no document camera")
        return
      }
      guard self.scan == nil else {
        promise.reject("ERR_SCAN_IN_PROGRESS", "A document scan is already open")
        return
      }
      // UIKit drops a presentation while another is still on its way in or out, and then no
      // callback runs at all, so the scan would never end.
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_DOCUMENT_SCAN", "There is no screen to show the document camera on")
        return
      }
      guard presenter.transitionCoordinator == nil else {
        promise.reject("ERR_DOCUMENT_SCAN", "Another screen is still opening or closing")
        return
      }
      // The scan is let go when it ends, which is all that frees it.
      let scan = DocumentScan(options: options, queue: self.queue) { self.scan = nil }
      scan.promise = promise
      self.scan = scan
      let camera = VNDocumentCameraViewController()
      camera.delegate = scan
      presenter.present(camera, animated: true)
      if camera.presentingViewController == nil {
        self.scan = nil
        promise.reject("ERR_DOCUMENT_SCAN", "The document camera could not be shown")
      }
    }.runOnQueue(.main)
  }

  /// The scan the document camera is open for. Kept here, since the camera holds its delegate
  /// weakly.
  private var scan: DocumentScan?

  struct ReadFailure: Error {
    let code: String
    let message: String
  }

  /// The text Vision reads in `image`, with each line's box in the image's upright pixels.
  static func read(_ image: OrientedImage, _ options: TextRecognitionOptions) throws -> [String: Any] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = options.level == .fast ? .fast : .accurate
    if let languages = options.languages, !languages.isEmpty {
      // Vision ignores a code it does not list, so one it cannot read is refused here.
      let supported = (try? request.supportedRecognitionLanguages()) ?? []
      let resolved = languages.map { Self.language($0, in: supported) }
      let unsupported = zip(languages, resolved).filter { $0.1 == nil }.map { $0.0 }
      if !unsupported.isEmpty {
        throw ReadFailure(
          code: "ERR_TEXT_RECOGNITION",
          message: "Vision cannot read \(unsupported.joined(separator: ", ")) at this level. It can read "
            + supported.joined(separator: ", "))
      }
      request.recognitionLanguages = resolved.compactMap { $0 }
    } else if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = true
    }
    try VNImageRequestHandler(cgImage: image.cgImage, orientation: image.orientation)
      .perform([request])
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
    return [
      "text": texts.joined(separator: "\n"),
      "lines": lines,
      "width": size.width,
      "height": size.height,
    ]
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

  struct OrientedImage {
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
  static func image(at uri: String) -> OrientedImage? {
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

/**
 One open document camera. Each page it scans is saved as a JPEG in the caches directory, where
 the system may remove it, and read like `recognize()` reads an image. Cancelled, it answers no
 pages.
 */
final class DocumentScan: NSObject, VNDocumentCameraViewControllerDelegate {
  var promise: Promise?
  private let options: TextRecognitionOptions
  private let queue: DispatchQueue
  private let ended: () -> Void

  init(options: TextRecognitionOptions, queue: DispatchQueue, ended: @escaping () -> Void) {
    self.options = options
    self.queue = queue
    self.ended = ended
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
  ) {
    // The pages are taken out on the main thread, where VisionKit hands them over.
    let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
    // Settled once the camera has gone, so the next scan finds the screen free to present on.
    controller.dismiss(animated: true) {
      self.queue.async { self.finish { try self.read(pages) } }
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true) { self.finish { [] } }
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController, didFailWithError error: Error
  ) {
    controller.dismiss(animated: true) {
      self.finish {
        throw TextRecognitionModule.ReadFailure(
          code: "ERR_DOCUMENT_SCAN", message: error.localizedDescription)
      }
    }
  }

  private func read(_ pages: [UIImage]) throws -> [[String: Any]] {
    let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let id = UUID().uuidString
    var saved: [URL] = []
    do {
      return try pages.enumerated().map { index, page in
        let url = folder.appendingPathComponent("ng-native-scan-\(id)-\(index + 1).jpg")
        guard let data = page.jpegData(compressionQuality: 0.9) else {
          throw TextRecognitionModule.ReadFailure(
            code: "ERR_DOCUMENT_SCAN", message: "Page \(index + 1) could not be saved")
        }
        try data.write(to: url)
        saved.append(url)
        guard let image = TextRecognitionModule.image(at: url.absoluteString) else {
          throw TextRecognitionModule.ReadFailure(
            code: "ERR_IMAGE_LOAD", message: "No image could be read at \(url.absoluteString)")
        }
        var found = try TextRecognitionModule.read(image, options)
        found["imageUri"] = url.absoluteString
        return found
      }
    } catch {
      // A failed scan answers no pages, so the ones already saved would never be found again.
      for url in saved { try? FileManager.default.removeItem(at: url) }
      throw error
    }
  }

  private func finish(_ answer: () throws -> [[String: Any]]) {
    guard let promise else { return }
    self.promise = nil
    let outcome = Result { try answer() }
    // Released before the promise settles, so a scan started from its answer finds none open.
    DispatchQueue.main.async(execute: ended)
    switch outcome {
    case .success(let pages):
      promise.resolve(pages)
    case .failure(let failure as TextRecognitionModule.ReadFailure):
      promise.reject(failure.code, failure.message)
    case .failure(let error):
      promise.reject("ERR_DOCUMENT_SCAN", error.localizedDescription)
    }
  }
}
