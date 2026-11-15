#include "language-model.h"

#include <cstdint>

// language-model.swift's C interface.
extern "C" {
void ngn_lm_availability(char *out, int32_t size);
void *ngn_lm_session_create(const char *config, void *context, void (*onTool)(void *, const char *, const char *, const char *),
                            void (*onFree)(void *), char *error, int32_t size);
void ngn_lm_session_respond(void *session, const char *prompt, bool stream, void *context, void (*onText)(void *, const char *),
                            void (*onDone)(void *, const char *, const char *, const char *));
void ngn_lm_session_cancel(void *session);
bool ngn_lm_tool_answer(void *session, const char *callId, const char *output, const char *error);
void ngn_lm_session_release(void *session);
}

namespace ngn::appkit {

namespace {

using ToolCalls = std::function<void(LanguageModelEngine::ToolCall)>;

struct TurnContext {
  std::function<void(const std::string &)> onText;
  std::function<void(LanguageModelEngine::Outcome)> done;
};

class SwiftSession final : public LanguageModelEngine::Session {
 public:
  explicit SwiftSession(void *handle) : handle_(handle) {}
  ~SwiftSession() override {
    ngn_lm_session_release(handle_);
  }

  void respond(const std::string &prompt, bool stream, std::function<void(const std::string &)> onText,
               std::function<void(LanguageModelEngine::Outcome)> done) override {
    // Freed by the one call to done.
    auto *turn = new TurnContext{std::move(onText), std::move(done)};
    ngn_lm_session_respond(
        handle_, prompt.c_str(), stream, turn,
        [](void *context, const char *text) { static_cast<TurnContext *>(context)->onText(text); },
        [](void *context, const char *text, const char *code, const char *message) {
          std::unique_ptr<TurnContext> turn(static_cast<TurnContext *>(context));
          LanguageModelEngine::Outcome outcome;
          if (text != nullptr) {
            outcome.text = text;
          } else {
            outcome.code = code != nullptr ? code : "ERR_GENERATION_FAILED";
            outcome.message = message != nullptr ? message : "";
          }
          turn->done(std::move(outcome));
        });
  }

  void cancel() override {
    ngn_lm_session_cancel(handle_);
  }

  void answerTool(const std::string &callId, const std::optional<std::string> &output, const std::string &error) override {
    ngn_lm_tool_answer(handle_, callId.c_str(), output ? output->c_str() : nullptr, error.c_str());
  }

 private:
  void *handle_;
};

class SwiftEngine final : public LanguageModelEngine {
 public:
  std::string availability() override {
    char out[32];
    ngn_lm_availability(out, sizeof out);
    return out;
  }

  std::unique_ptr<Session> session(const std::string &config, std::function<void(ToolCall)> onToolCall, std::string &error) override {
    // Freed by Swift once nothing there can call it.
    auto *calls = new ToolCalls(std::move(onToolCall));
    char reason[512];
    void *handle = ngn_lm_session_create(
        config.c_str(), calls,
        [](void *context, const char *id, const char *tool, const char *arguments) {
          (*static_cast<ToolCalls *>(context))({.id = id, .tool = tool, .arguments = arguments});
        },
        [](void *context) { delete static_cast<ToolCalls *>(context); }, reason, sizeof reason);
    if (handle == nullptr) {
      error = reason;
      return nullptr;
    }
    return std::make_unique<SwiftSession>(handle);
  }
};

} // namespace

std::shared_ptr<LanguageModelEngine> makeLanguageModelEngine() {
  return std::make_shared<SwiftEngine>();
}

} // namespace ngn::appkit
