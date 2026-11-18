// Hermes's Unicode layer, which is the system's on macOS and the static ICU elsewhere
// (scripts/build-icu.sh). Without one, Hermes falls back to stubs that map no case and normalize
// nothing, so these fail.
#include <doctest/doctest.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <memory>
#include <string>

namespace {

std::string evaluate(facebook::jsi::Runtime &runtime, const std::string &script) {
  auto value = runtime.evaluateJavaScript(std::make_shared<facebook::jsi::StringBuffer>(script), "test.js");
  return value.toString(runtime).utf8(runtime);
}

} // namespace

TEST_CASE("Hermes maps case, normalizes and compares beyond ASCII") {
  auto runtime = facebook::hermes::makeHermesRuntime();
  CHECK(evaluate(*runtime, "'straße'.toUpperCase()") == "STRASSE");
  CHECK(evaluate(*runtime, "'ÉCOLE'.toLowerCase()") == "école");
  CHECK(evaluate(*runtime, "'A\\u030A'.normalize('NFC') === '\\u00C5'") == "true");
  CHECK(evaluate(*runtime, "'\\u00C5'.normalize('NFD').length") == "2");
  // Properties every locale shares, since the order of a letter like ä depends on the locale.
  CHECK(evaluate(*runtime, "'\\u00E4'.localeCompare('a\\u0308')") == "0");
  CHECK(evaluate(*runtime, "'a'.localeCompare('b')") == "-1");
}
