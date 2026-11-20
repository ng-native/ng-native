#include "ngn/text-units.h"

#include <doctest/doctest.h>

using ngn::TextBreaks;
using ngn::TextSpan;
using ngn::TextUnit;
using ngn::textUnitAt;

namespace {

// "Hello world. Bye now" laid out on two lines, the second starting at "Bye".
const std::string kText = "Hello world. Bye now";
const TextBreaks kBreaks{.words = {0, 6, 13, 17}, .sentences = {0, 13}, .lines = {0, 13}};

} // namespace

TEST_CASE("a character is the one at the offset, and none at the end") {
  CHECK(textUnitAt(kText, kBreaks, 4, TextUnit::Character) == TextSpan{4, 5});
  CHECK(textUnitAt(kText, kBreaks, 20, TextUnit::Character) == TextSpan{20, 20});
  CHECK(textUnitAt(kText, kBreaks, 99, TextUnit::Character) == TextSpan{20, 20});
  CHECK(textUnitAt(kText, kBreaks, -3, TextUnit::Character) == TextSpan{0, 1});
}

TEST_CASE("a word runs from its start to the next word's, taking the spaces after it") {
  CHECK(textUnitAt(kText, kBreaks, 0, TextUnit::Word) == TextSpan{0, 6});
  CHECK(textUnitAt(kText, kBreaks, 3, TextUnit::Word) == TextSpan{0, 6});
  // On the space after a word: still that word.
  CHECK(textUnitAt(kText, kBreaks, 5, TextUnit::Word) == TextSpan{0, 6});
  CHECK(textUnitAt(kText, kBreaks, 6, TextUnit::Word) == TextSpan{6, 13});
  CHECK(textUnitAt(kText, kBreaks, 18, TextUnit::Word) == TextSpan{17, 20});
}

TEST_CASE("a sentence and a line run to the next one's start, or the end") {
  CHECK(textUnitAt(kText, kBreaks, 8, TextUnit::Sentence) == TextSpan{0, 13});
  CHECK(textUnitAt(kText, kBreaks, 15, TextUnit::Sentence) == TextSpan{13, 20});
  CHECK(textUnitAt(kText, kBreaks, 12, TextUnit::Line) == TextSpan{0, 13});
  CHECK(textUnitAt(kText, kBreaks, 13, TextUnit::Line) == TextSpan{13, 20});
  CHECK(textUnitAt(kText, kBreaks, 20, TextUnit::Line) == TextSpan{13, 20});
}

TEST_CASE("a paragraph ends after its line break, in characters, not bytes") {
  // "é" is two bytes and one character.
  std::string text = "Café\nThé\n\nFin";
  CHECK(textUnitAt(text, {}, 2, TextUnit::Paragraph) == TextSpan{0, 5});
  CHECK(textUnitAt(text, {}, 4, TextUnit::Paragraph) == TextSpan{0, 5});
  CHECK(textUnitAt(text, {}, 6, TextUnit::Paragraph) == TextSpan{5, 9});
  CHECK(textUnitAt(text, {}, 9, TextUnit::Paragraph) == TextSpan{9, 10});
  CHECK(textUnitAt(text, {}, 11, TextUnit::Paragraph) == TextSpan{10, 13});
}

TEST_CASE("a paragraph also ends after a carriage return, a CRLF pair and a paragraph separator") {
  // U+2029 is three bytes and one character.
  std::string separator = "A\xE2\x80\xA9" "B";
  CHECK(textUnitAt(separator, {}, 2, TextUnit::Paragraph) == TextSpan{2, 3});
  CHECK(textUnitAt(separator, {}, 0, TextUnit::Paragraph) == TextSpan{0, 2});
  std::string cr = "A\rB";
  CHECK(textUnitAt(cr, {}, 2, TextUnit::Paragraph) == TextSpan{2, 3});
  CHECK(textUnitAt(cr, {}, 0, TextUnit::Paragraph) == TextSpan{0, 2});
  // CRLF is one delimiter: no empty paragraph between the two.
  std::string crlf = "A\r\nB";
  CHECK(textUnitAt(crlf, {}, 1, TextUnit::Paragraph) == TextSpan{0, 3});
  CHECK(textUnitAt(crlf, {}, 3, TextUnit::Paragraph) == TextSpan{3, 4});
  // A trailing delimiter leaves no unit to read, as with LF.
  std::string trailing = "A\xE2\x80\xA9";
  CHECK(textUnitAt(trailing, {}, 1, TextUnit::Paragraph) == TextSpan{0, 2});
}

TEST_CASE("no breaks known is one unit, and empty text is the empty span") {
  CHECK(textUnitAt(kText, {}, 7, TextUnit::Line) == TextSpan{0, 20});
  CHECK(textUnitAt("", kBreaks, 3, TextUnit::Word) == TextSpan{0, 0});
}

TEST_CASE("the text between two offsets counts characters and clamps to the text") {
  CHECK(ngn::textBetween("Café crème", 2, 6) == "fé c");
  CHECK(ngn::textBetween("Café", 3, 99) == "é");
  CHECK(ngn::textBetween("Café", 3, 1).empty());
}
