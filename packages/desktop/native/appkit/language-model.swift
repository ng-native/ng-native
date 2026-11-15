// The Swift half of NgNativeLocalLlm: Apple's Foundation Models, which only Swift can call, behind
// a C interface that language-model.mm adapts to the core's LanguageModelEngine. macOS 26 and
// later; on an older system every session fails and the availability is notEligible.
//
// The model's mechanics follow expo-local-llm's iOS module (MIT): the availability names, the
// schema for structured output and tool arguments, tool calls answered from JavaScript with a
// timeout, and the error codes JavaScript reads.
import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

public typealias NGNLMText = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>) -> Void
// The turn's context, then the text, or the error's code and message.
public typealias NGNLMDone = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> Void
// The session's context, the call's id, the tool's name and its arguments as JSON.
public typealias NGNLMTool = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
public typealias NGNLMFree = @convention(c) (UnsafeMutableRawPointer?) -> Void

private func copyOut(_ text: String, _ out: UnsafeMutablePointer<CChar>, _ size: Int32) {
  let bytes = Array(text.utf8.prefix(Int(size) - 1))
  for (index, byte) in bytes.enumerated() {
    out[index] = CChar(bitPattern: byte)
  }
  out[bytes.count] = 0
}

/// The availability as expo-local-llm names it, into `out`.
@_cdecl("ngn_lm_availability")
public func ngnLMAvailability(_ out: UnsafeMutablePointer<CChar>, _ size: Int32) {
  var name = "notEligible"
  #if canImport(FoundationModels)
  if #available(macOS 26, *) {
    name = NGNLanguageModel.availability()
  }
  #endif
  copyOut(name, out, size)
}

/// A session for `config` (expo-local-llm's SessionConfig as JSON), or null with the reason in
/// `error`. Tool calls go to `onTool` with `context`, which `onFree` frees once nothing can call it.
@_cdecl("ngn_lm_session_create")
public func ngnLMSessionCreate(
  _ config: UnsafePointer<CChar>, _ context: UnsafeMutableRawPointer?, _ onTool: NGNLMTool, _ onFree: NGNLMFree,
  _ error: UnsafeMutablePointer<CChar>, _ size: Int32
) -> UnsafeMutableRawPointer? {
  let owner = NGNContext(context, onFree)
  #if canImport(FoundationModels)
  if #available(macOS 26, *) {
    do {
      let session = try NGNLanguageModel(config: String(cString: config), owner: owner, onTool: onTool)
      return Unmanaged.passRetained(session).toOpaque()
    } catch let failure {
      copyOut(failure.localizedDescription, error, size)
      return nil
    }
  }
  #endif
  copyOut("Apple's on-device model needs macOS 26", error, size)
  return nil
}

/// One turn. `onDone` is called exactly once, `onText` with the text so far before it when
/// streaming.
@_cdecl("ngn_lm_session_respond")
public func ngnLMSessionRespond(
  _ handle: UnsafeMutableRawPointer, _ prompt: UnsafePointer<CChar>, _ stream: Bool, _ context: UnsafeMutableRawPointer?,
  _ onText: NGNLMText, _ onDone: NGNLMDone
) {
  #if canImport(FoundationModels)
  if #available(macOS 26, *) {
    let session = Unmanaged<NGNLanguageModel>.fromOpaque(handle).takeUnretainedValue()
    // The address, which is Sendable where the pointer is not; the C side keeps the turn's context
    // until onDone.
    let turn = UInt(bitPattern: context)
    session.respond(String(cString: prompt), stream: stream) { text in
      text.withCString { onText(UnsafeMutableRawPointer(bitPattern: turn), $0) }
    } done: { text, code, message in
      let context = UnsafeMutableRawPointer(bitPattern: turn)
      if let text {
        text.withCString { onDone(context, $0, nil, nil) }
      } else {
        (code ?? "ERR_GENERATION_FAILED").withCString { c in
          (message ?? "").withCString { m in onDone(context, nil, c, m) }
        }
      }
    }
    return
  }
  #endif
  onDone(context, nil, "ERR_MODEL_UNAVAILABLE", "Apple's on-device model needs macOS 26")
}

@_cdecl("ngn_lm_session_cancel")
public func ngnLMSessionCancel(_ handle: UnsafeMutableRawPointer) {
  #if canImport(FoundationModels)
  if #available(macOS 26, *) {
    Unmanaged<NGNLanguageModel>.fromOpaque(handle).takeUnretainedValue().cancel()
  }
  #endif
}

/// Answers a tool call: its output, or the error when `output` is null.
@_cdecl("ngn_lm_tool_answer")
public func ngnLMToolAnswer(
  _ handle: UnsafeMutableRawPointer, _ callId: UnsafePointer<CChar>, _ output: UnsafePointer<CChar>?, _ error: UnsafePointer<CChar>?
) -> Bool {
  #if canImport(FoundationModels)
  if #available(macOS 26, *) {
    let session = Unmanaged<NGNLanguageModel>.fromOpaque(handle).takeUnretainedValue()
    let id = String(cString: callId)
    if let output {
      return session.store.resolve(callId: id, result: String(cString: output))
    }
    return session.store.reject(callId: id, error: NGNToolError.handlerFailed(error.map { String(cString: $0) } ?? ""))
  }
  #endif
  return false
}

/// Ends the session: its turn is cancelled and its tool calls rejected.
@_cdecl("ngn_lm_session_release")
public func ngnLMSessionRelease(_ handle: UnsafeMutableRawPointer) {
  #if canImport(FoundationModels)
  if #available(macOS 26, *) {
    let session = Unmanaged<NGNLanguageModel>.fromOpaque(handle).takeRetainedValue()
    session.close()
  }
  #endif
}

/// The C side's context, freed when the last thing that could call it goes.
final class NGNContext: @unchecked Sendable {
  let pointer: UnsafeMutableRawPointer?
  private let free: NGNLMFree
  init(_ pointer: UnsafeMutableRawPointer?, _ free: @escaping NGNLMFree) {
    self.pointer = pointer
    self.free = free
  }
  deinit {
    free(pointer)
  }
}

enum NGNToolError: LocalizedError {
  case timeout
  case handlerFailed(String)
  case invalidArguments

  var errorDescription: String? {
    switch self {
    case .timeout: return "Tool call timed out waiting for JavaScript response"
    case .handlerFailed(let message): return "Tool handler error: \(message)"
    case .invalidArguments: return "Tool arguments were not a JSON object"
    }
  }
}

enum NGNSchemaError: LocalizedError {
  case unsupportedType(String)
  case malformed(String)

  var errorDescription: String? {
    switch self {
    case .unsupportedType(let type): return "Unsupported schema type: \(type)"
    case .malformed(let message): return "Malformed schema: \(message)"
    }
  }
}

/// Pending tool calls, each answered once: by JavaScript, its timeout, or the session closing.
final class NGNToolCalls: @unchecked Sendable {
  private var pending: [String: (CheckedContinuation<String, Error>, Task<Void, Never>?)] = [:]
  private var closed = false
  private let lock = NSLock()

  func store(callId: String, continuation: CheckedContinuation<String, Error>) -> Bool {
    lock.lock()
    if closed {
      lock.unlock()
      continuation.resume(throwing: CancellationError())
      return false
    }
    pending[callId] = (continuation, nil)
    lock.unlock()
    return true
  }

  func attachTimeout(callId: String, task: Task<Void, Never>) {
    lock.lock()
    if pending[callId] != nil {
      pending[callId]?.1 = task
      lock.unlock()
    } else {
      lock.unlock()
      task.cancel()
    }
  }

  private func remove(callId: String) -> CheckedContinuation<String, Error>? {
    lock.lock()
    let entry = pending.removeValue(forKey: callId)
    lock.unlock()
    entry?.1?.cancel()
    return entry?.0
  }

  func resolve(callId: String, result: String) -> Bool {
    guard let continuation = remove(callId: callId) else { return false }
    continuation.resume(returning: result)
    return true
  }

  func reject(callId: String, error: Error) -> Bool {
    guard let continuation = remove(callId: callId) else { return false }
    continuation.resume(throwing: error)
    return true
  }

  func close() {
    lock.lock()
    closed = true
    let entries = pending
    pending.removeAll()
    lock.unlock()
    for (_, entry) in entries {
      entry.1?.cancel()
      entry.0.resume(throwing: CancellationError())
    }
  }
}

#if canImport(FoundationModels)

@available(macOS 26, *)
enum NGNSchema {
  static func build(properties: [String: Any], rootName: String) throws -> GenerationSchema {
    try GenerationSchema(root: object(name: rootName, properties: properties), dependencies: [])
  }

  private static func object(name: String, properties: [String: Any]) throws -> DynamicGenerationSchema {
    let fields: [DynamicGenerationSchema.Property] = try properties.keys.sorted().map { key in
      guard let field = properties[key] as? [String: Any] else {
        throw NGNSchemaError.malformed("Field '\(key)' must be an object")
      }
      return DynamicGenerationSchema.Property(
        name: key, description: field["description"] as? String,
        schema: try schema(name: key, type: field["type"] as? String ?? "string", field: field))
    }
    return DynamicGenerationSchema(name: name, properties: fields)
  }

  private static func schema(name: String, type: String, field: [String: Any]) throws -> DynamicGenerationSchema {
    switch type {
    case "string":
      if let values = field["enum"] as? [String] {
        return DynamicGenerationSchema(name: name, anyOf: values)
      }
      return DynamicGenerationSchema(type: String.self)
    case "number": return DynamicGenerationSchema(type: Double.self)
    case "integer": return DynamicGenerationSchema(type: Int.self)
    case "boolean": return DynamicGenerationSchema(type: Bool.self)
    case "array":
      guard let items = field["items"] as? [String: Any] else {
        throw NGNSchemaError.malformed("Array field '\(name)' must declare 'items'")
      }
      return DynamicGenerationSchema(
        arrayOf: try schema(name: "\(name)Item", type: items["type"] as? String ?? "string", field: items))
    case "object":
      return try object(name: name, properties: field["properties"] as? [String: Any] ?? [:])
    default:
      throw NGNSchemaError.unsupportedType(type)
    }
  }
}

/// A tool whose calls JavaScript answers. Its arguments are decoded against its parameters.
@available(macOS 26, *)
final class NGNTool: Tool {
  let name: String
  let description: String
  let parameters: GenerationSchema
  typealias Arguments = GeneratedContent

  private let owner: NGNContext
  private let onTool: NGNLMTool
  private let calls: NGNToolCalls
  private let timeout: TimeInterval

  init(name: String, description: String, parameters: GenerationSchema, timeout: TimeInterval, calls: NGNToolCalls,
       owner: NGNContext, onTool: NGNLMTool) {
    self.name = name
    self.description = description
    self.parameters = parameters
    self.timeout = timeout
    self.calls = calls
    self.owner = owner
    self.onTool = onTool
  }

  func call(arguments: GeneratedContent) async throws -> String {
    let callId = UUID().uuidString
    let json = arguments.jsonString
    guard let data = json.data(using: .utf8), (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else {
      throw NGNToolError.invalidArguments
    }
    let calls = self.calls
    return try await withTaskCancellationHandler {
      // Stored before JavaScript hears of it, so an answer at once has a call to resume.
      try await withCheckedThrowingContinuation { continuation in
        guard calls.store(callId: callId, continuation: continuation) else { return }
        let timeout = self.timeout
        let timer = Task {
          try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
          if !Task.isCancelled {
            _ = calls.reject(callId: callId, error: NGNToolError.timeout)
          }
        }
        calls.attachTimeout(callId: callId, task: timer)
        if Task.isCancelled {
          _ = calls.reject(callId: callId, error: CancellationError())
          return
        }
        callId.withCString { id in
          name.withCString { tool in
            json.withCString { args in onTool(owner.pointer, id, tool, args) }
          }
        }
      }
    } onCancel: {
      _ = calls.reject(callId: callId, error: CancellationError())
    }
  }
}

@available(macOS 26, *)
final class NGNLanguageModel: @unchecked Sendable {
  let store: NGNToolCalls
  private let session: LanguageModelSession
  private let options: GenerationOptions
  private let schema: GenerationSchema?
  private let includeSchemaInPrompt: Bool
  private let lock = NSLock()
  private var task: Task<Void, Never>?

  static func availability() -> String {
    switch SystemLanguageModel.default.availability {
    case .available: return "available"
    case .unavailable(let reason):
      switch reason {
      case .deviceNotEligible: return "notEligible"
      case .modelNotReady: return "notReady"
      case .appleIntelligenceNotEnabled: return "notEnabled"
      @unknown default: return "unknown"
      }
    @unknown default: return "unknown"
    }
  }

  init(config text: String, owner: NGNContext, onTool: NGNLMTool) throws {
    let config = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
    let instructions = config["instructions"] as? String
    let sampling = config["options"] as? [String: Any] ?? [:]
    let topK = sampling["topK"] as? Int
    options = GenerationOptions(
      sampling: topK.map { .random(top: $0) }, temperature: sampling["temperature"] as? Double,
      maximumResponseTokens: sampling["maxTokens"] as? Int)
    includeSchemaInPrompt = config["includeSchemaInPrompt"] as? Bool ?? true
    if config["responseFormat"] as? String == "json", let properties = config["schema"] as? [String: Any] {
      schema = try NGNSchema.build(properties: properties, rootName: "Response")
    } else {
      schema = nil
    }
    let timeout = config["toolTimeout"] as? Double ?? 30
    let store = NGNToolCalls()
    self.store = store
    let tools: [any Tool] = try (config["tools"] as? [[String: Any]] ?? []).map { tool in
      let name = tool["name"] as? String ?? ""
      return NGNTool(
        name: name, description: tool["description"] as? String ?? "",
        parameters: try NGNSchema.build(properties: tool["parameters"] as? [String: Any] ?? [:], rootName: "\(name)Arguments"),
        timeout: timeout, calls: store, owner: owner, onTool: onTool)
    }
    session = instructions.map { LanguageModelSession(tools: tools, instructions: $0) } ?? LanguageModelSession(tools: tools)
    // Keeps the C side's context for as long as the session is, even with no tools.
    self.owner = owner
  }

  private let owner: NGNContext

  func respond(_ prompt: String, stream: Bool, onText: @escaping @Sendable (String) -> Void,
               done: @escaping @Sendable (String?, String?, String?) -> Void) {
    let session = self.session
    let options = self.options
    let schema = self.schema
    let includeSchemaInPrompt = self.includeSchemaInPrompt
    let running = Task {
      do {
        var text = ""
        if stream, let schema {
          for try await snapshot in session.streamResponse(
            to: prompt, schema: schema, includeSchemaInPrompt: includeSchemaInPrompt, options: options) {
            text = snapshot.content.jsonString
            onText(text)
          }
        } else if stream {
          for try await partial in session.streamResponse(to: prompt, options: options) {
            text = partial.content
            onText(text)
          }
        } else if let schema {
          text = try await session.respond(
            to: prompt, schema: schema, includeSchemaInPrompt: includeSchemaInPrompt, options: options
          ).content.jsonString
        } else {
          text = try await session.respond(to: prompt, options: options).content
        }
        try Task.checkCancellation()
        done(text, nil, nil)
      } catch {
        done(nil, NGNLanguageModel.code(for: error), error.localizedDescription)
      }
    }
    lock.lock()
    task = running
    lock.unlock()
  }

  func cancel() {
    lock.lock()
    let running = task
    lock.unlock()
    running?.cancel()
  }

  func close() {
    store.close()
    cancel()
  }

  static func code(for error: Error) -> String {
    if error is CancellationError { return "ERR_CANCELLED" }
    if error is NGNToolError { return "ERR_TOOL_FAILED" }
    if let failure = error as? LanguageModelSession.GenerationError {
      switch failure {
      case .exceededContextWindowSize: return "ERR_CONTEXT_WINDOW_EXCEEDED"
      case .assetsUnavailable: return "ERR_MODEL_UNAVAILABLE"
      case .guardrailViolation: return "ERR_GUARDRAIL_VIOLATION"
      case .unsupportedGuide: return "ERR_UNSUPPORTED_REQUEST"
      case .unsupportedLanguageOrLocale: return "ERR_UNSUPPORTED_LANGUAGE"
      case .decodingFailure: return "ERR_DECODING_FAILED"
      case .rateLimited: return "ERR_RATE_LIMITED"
      case .concurrentRequests: return "ERR_SESSION_BUSY"
      case .refusal: return "ERR_REFUSAL"
      @unknown default: return "ERR_GENERATION_FAILED"
      }
    }
    if let failure = error as? LanguageModelSession.ToolCallError {
      return code(for: failure.underlyingError) == "ERR_CANCELLED" ? "ERR_CANCELLED" : "ERR_TOOL_FAILED"
    }
    return "ERR_GENERATION_FAILED"
  }
}

#endif
