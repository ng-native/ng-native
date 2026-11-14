#include "ngn/download.h"

#include <filesystem>
#include <fstream>

namespace ngn {

void downloadFile(const std::shared_ptr<Http> &http, const std::string &url, const std::string &target, std::function<void(const std::string &error)> done) {
  // The body, and the task kept alive until it completes.
  struct Download {
    std::string body;
    uint16_t status{0};
    std::unique_ptr<HttpTask> task;
  };
  auto download = std::make_shared<Download>();
  download->task = http->send(
      {.url = url},
      {.onResponse = [download](const HttpResponse &response) { download->status = response.status; },
       .onData = [download](std::string chunk, int64_t) { download->body += chunk; },
       .onComplete =
           [download, target, done](const std::string &error, bool) {
             auto keep = std::move(download->task);
             if (!error.empty() || download->status < 200 || download->status >= 300) {
               done(error.empty() ? "HTTP " + std::to_string(download->status) : error);
               return;
             }
             std::error_code ignored;
             std::filesystem::create_directories(std::filesystem::path(target).parent_path(), ignored);
             std::ofstream out(target, std::ios::binary | std::ios::trunc);
             out << download->body;
             out.close();
             if (!out) {
               // A file cut short is no file: nothing reads it as the download.
               std::filesystem::remove(target, ignored);
               done("could not be saved to " + target);
               return;
             }
             done("");
           }});
}

} // namespace ngn
