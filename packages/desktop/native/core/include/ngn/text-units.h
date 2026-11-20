// What a screen reader reads of a run of text when it moves by character, word, sentence, line or
// paragraph: the span of that unit around a character, as AT-SPI's Text interface answers
// GetStringAtOffset. The toolkit's text layout finds where words, sentences and lines start (Pango's
// log attributes on Linux); the spans are worked out here, the same for any toolkit. Offsets count
// characters (Unicode code points), as AT-SPI's do.
#pragma once

#include <string>
#include <vector>

namespace ngn {

enum class TextUnit { Character, Word, Sentence, Line, Paragraph };

struct TextSpan {
  int start{0};
  int end{0};
  bool operator==(const TextSpan &other) const = default;
};

// Where each unit but characters and paragraphs starts, in character offsets, ascending. A list
// that does not start at 0 is read as if it did.
struct TextBreaks {
  std::vector<int> words;
  std::vector<int> sentences;
  std::vector<int> lines;
};

// The span of `unit` holding the character at `offset` in `text` (UTF-8), from the start of that
// unit to the start of the next one, or the end of the text: a word takes the spaces after it, and
// a paragraph its line break. An offset past either end is taken at that end. A character at the
// end is the empty span there.
TextSpan textUnitAt(const std::string &text, const TextBreaks &breaks, int offset, TextUnit unit);

// The characters from `start` to `end` of `text` (UTF-8), clamped to it.
std::string textBetween(const std::string &text, int start, int end);

} // namespace ngn
