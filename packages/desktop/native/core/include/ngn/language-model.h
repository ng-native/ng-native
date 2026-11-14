// NgNativeLocalLlm: what @ng-native/expo's LanguageModel calls on expo-local-llm, over a
// LanguageModelEngine, which the AppKit backend implements with Apple's Foundation Models on macOS
// 26 and later. Sessions are ids; the JS adapter (desktop-local-llm.ts) wraps them in the shape of
// expo-local-llm's LLMSession.
//
// - getAvailability(): expo-local-llm's names: available, notEligible (before macOS 26, or a Mac
//   that cannot run it), notEnabled (Apple Intelligence off), notReady, unknown.
// - downloadModel(): resolves; macOS manages the model.
// - createSession(config) -> id: expo-local-llm's SessionConfig (instructions, options, tools,
//   toolTimeout, responseFormat and schema). Throws for a config the model cannot take.
// - respond(id, prompt, requestId), streamResponse(id, prompt, requestId): the text, or for a
//   json responseFormat the JSON. Rejects "CODE: message" with expo-local-llm's codes:
//   ERR_MODEL_UNAVAILABLE while the model is not available, ERR_SESSION_BUSY while the session's
//   last turn runs, and the model's own (ERR_CONTEXT_WINDOW_EXCEEDED and the rest). A cancelled
//   turn resolves with the text so far.
// - cancelStream(id), release(id), resolveToolCall(id, callId, output),
//   rejectToolCall(id, callId, error).
// - `ngNativeLocalLlm` events: {type: 'token', session, requestId, accumulated} as a stream is
//   written, and {type: 'toolCall', session, requestId, callId, toolName, arguments} when the model
//   calls a tool, which resolveToolCall or rejectToolCall answers.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

class LanguageModelEngine {
 public:
  struct Outcome {
    // The text when the turn succeeded.
    std::optional<std::string> text;
    // expo-local-llm's code and the message when it failed; ERR_CANCELLED when it was cancelled.
    std::string code;
    std::string message;
  };
  struct ToolCall {
    std::string id;
    std::string tool;
    // The arguments as JSON.
    std::string arguments;
  };

  class Session {
   public:
    // Ends the session: a running turn is cancelled, and pending tool calls rejected.
    virtual ~Session() = default;
    // One turn. `onText` with the text so far as a stream is written; `done` once, last. Any thread.
    virtual void respond(const std::string &prompt, bool stream, std::function<void(const std::string &)> onText,
                         std::function<void(Outcome)> done) = 0;
    virtual void cancel() = 0;
    // Answers a call `onToolCall` made: the output, or the error when there is none.
    virtual void answerTool(const std::string &callId, const std::optional<std::string> &output, const std::string &error) = 0;
  };

  virtual ~LanguageModelEngine() = default;
  virtual std::string availability() = 0;
  // A session for the config as JSON, or null with the reason in `error`. `onToolCall` on any thread.
  virtual std::unique_ptr<Session> session(const std::string &config, std::function<void(ToolCall)> onToolCall,
                                           std::string &error) = 0;
};

std::shared_ptr<NativeModule> makeLocalLlmModule(std::shared_ptr<LanguageModelEngine> engine);

} // namespace ngn
