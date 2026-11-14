#include "ngn/download.h"

#include <filesystem>
#include <fstream>

namespace ngn {

void fetchBytes(const std::shared_ptr<Http> &http, const std::string &url, std::function<void(std::string body, const std::string &error)> done) {
  fetchBytes(http, HttpRequest{.url = url}, std::move(done));
}

void fetchBytes(const std::shared_ptr<Http> &http, HttpRequest request, std::function<void(std::string body, const std::string &error)> done) {
  // The body, and the task kept alive until it completes.
  struct Fetch {
    std::string body;
    uint16_t status{0};
    std::unique_ptr<HttpTask> task;
  };
  auto fetch = std::make_shared<Fetch>();
  fetch->task = http->send(
      std::move(request),
      {.onResponse = [fetch](const HttpResponse &response) { fetch->status = response.status; },
       .onData = [fetch](std::string chunk, int64_t) { fetch->body += chunk; },
       .onComplete =
           [fetch, done](const std::string &error, bool) {
             auto keep = std::move(fetch->task);
             if (!error.empty() || fetch->status < 200 || fetch->status >= 300) {
               done("", error.empty() ? "HTTP " + std::to_string(fetch->status) : error);
               return;
             }
             done(std::move(fetch->body), "");
           }});
}

void downloadFile(const std::shared_ptr<Http> &http, const std::string &url, const std::string &target, std::function<void(const std::string &error)> done) {
  fetchBytes(http, url, [target, done](std::string body, const std::string &error) {
    if (!error.empty()) {
      done(error);
      return;
    }
    std::error_code ignored;
    std::filesystem::create_directories(std::filesystem::path(target).parent_path(), ignored);
    std::ofstream out(target, std::ios::binary | std::ios::trunc);
    out << body;
    out.close();
    if (!out) {
      // A file cut short is no file: nothing reads it as the download.
      std::filesystem::remove(target, ignored);
      done("could not be saved to " + target);
      return;
    }
    done("");
  });
}

} // namespace ngn
