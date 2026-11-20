#include "ngn/text-units.h"

#include <algorithm>

namespace ngn {

namespace {

bool continuation(char byte) {
  return (static_cast<unsigned char>(byte) & 0xC0) == 0x80;
}

// The byte where character `index` starts, or the text's size past its end.
size_t byteOf(const std::string &text, int index) {
  size_t byte = 0;
  for (int i = 0; i < index && byte < text.size(); i++) {
    byte++;
    while (byte < text.size() && continuation(text[byte])) {
      byte++;
    }
  }
  return byte;
}

int characters(const std::string &text) {
  return static_cast<int>(std::count_if(text.begin(), text.end(), [](char c) { return !continuation(c); }));
}

// Where each paragraph starts: 0, and after each delimiter Pango's paragraph boundary knows: LF, CR
// (CRLF is one), and U+2029 (E2 80 A9).
std::vector<int> paragraphStarts(const std::string &text) {
  std::vector<int> starts{0};
  int index = 0;
  for (size_t i = 0; i < text.size(); i++) {
    char c = text[i];
    if (continuation(c)) {
      continue;
    }
    index++;
    bool separator = text.compare(i, 3, "\xE2\x80\xA9") == 0;
    bool crlf = c == '\r' && i + 1 < text.size() && text[i + 1] == '\n';
    if ((c == '\n' || c == '\r' || separator) && !crlf) {
      starts.push_back(index);
    }
  }
  return starts;
}

// The unit holding `offset`: from the last start at or before it to the next start after it.
TextSpan around(const std::vector<int> &starts, int length, int offset) {
  int start = 0;
  int end = length;
  for (int at : starts) {
    if (at <= offset) {
      start = std::max(start, at);
    } else if (at < end) {
      end = at;
    }
  }
  // An offset at the very end belongs to the last unit, which ends there.
  return {std::min(start, length), end};
}

} // namespace

TextSpan textUnitAt(const std::string &text, const TextBreaks &breaks, int offset, TextUnit unit) {
  int length = characters(text);
  offset = std::clamp(offset, 0, length);
  switch (unit) {
    case TextUnit::Character:
      return {offset, std::min(offset + 1, length)};
    case TextUnit::Word:
      return around(breaks.words, length, offset);
    case TextUnit::Sentence:
      return around(breaks.sentences, length, offset);
    case TextUnit::Line:
      return around(breaks.lines, length, offset);
    case TextUnit::Paragraph: {
      auto starts = paragraphStarts(text);
      // The empty paragraph after a final line break is no unit to read.
      if (starts.size() > 1 && starts.back() == length) {
        starts.pop_back();
      }
      return around(starts, length, offset);
    }
  }
  return {offset, offset};
}

std::string textBetween(const std::string &text, int start, int end) {
  if (end <= start) {
    return {};
  }
  size_t from = byteOf(text, std::max(start, 0));
  size_t to = byteOf(text, end);
  return text.substr(from, to - from);
}

} // namespace ngn
