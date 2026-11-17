// A canvas that records each drawing call as a line, for tests of what the core draws.
#pragma once

#include "ngn/svg.h"

#include <cmath>
#include <cstdint>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

namespace {

using RecorderOp = ngn::SvgPath::Op;

// Every call as a line, numbers rounded to two places so a test reads them.
struct Recorder : ngn::SvgCanvas {
  std::vector<std::string> calls;

  static std::string n(double v) {
    std::ostringstream out;
    double r = std::round(v * 100) / 100;
    out << (r == 0 ? 0 : r);
    return out.str();
  }
  static std::string path(const ngn::SvgPath &p) {
    std::string out;
    for (const auto &s : p.segments) {
      switch (s.op) {
        case RecorderOp::Move:
          out += "M" + n(s.points[0]) + "," + n(s.points[1]);
          break;
        case RecorderOp::Line:
          out += "L" + n(s.points[0]) + "," + n(s.points[1]);
          break;
        case RecorderOp::Cubic:
          out += "C" + n(s.points[4]) + "," + n(s.points[5]);
          break;
        case RecorderOp::Close:
          out += "Z";
          break;
      }
    }
    return out;
  }
  static std::string paint(const ngn::SvgPaint &p) {
    std::ostringstream out;
    if (p.gradient) {
      const auto &g = *p.gradient;
      out << (g.radial ? "radial(" : "linear(") << n(g.x1) << "," << n(g.y1) << " " << n(g.x2) << "," << n(g.y2);
      if (g.radial) {
        out << " r" << n(g.r);
      }
      out << " stops" << g.stops.size() << " t" << n(g.transform.a) << "," << n(g.transform.d) << "," << n(g.transform.e) << ","
          << n(g.transform.f) << ")";
    } else {
      out << "#" << std::hex << p.argb << std::dec;
    }
    if (p.opacity != 1) {
      out << " @" << n(p.opacity);
    }
    return out.str();
  }

  void save() override { calls.push_back("save"); }
  void restore() override { calls.push_back("restore"); }
  void concat(const ngn::SvgMatrix &m) override {
    calls.push_back("concat " + n(m.a) + " " + n(m.b) + " " + n(m.c) + " " + n(m.d) + " " + n(m.e) + " " + n(m.f));
  }
  void clip(const ngn::SvgPath &p, bool evenOdd) override { calls.push_back("clip " + path(p) + (evenOdd ? " evenodd" : "")); }
  void fill(const ngn::SvgPath &p, bool evenOdd, const ngn::SvgPaint &paint) override {
    calls.push_back("fill " + path(p) + (evenOdd ? " evenodd " : " ") + Recorder::paint(paint));
  }
  void stroke(const ngn::SvgPath &p, const ngn::SvgStroke &s, const ngn::SvgPaint &paint) override {
    std::string dashes;
    for (double d : s.dashes) {
      dashes += " " + n(d);
    }
    calls.push_back(
        "stroke " + path(p) + " w" + n(s.width) + " cap" + std::to_string(s.cap) + " join" + std::to_string(s.join) +
        (dashes.empty() ? "" : " dash" + dashes) + " " + Recorder::paint(paint));
  }
  void beginLayer(double opacity) override { calls.push_back("layer " + n(opacity)); }
  void endLayer() override { calls.push_back("end layer"); }
  void beginMask(bool alpha) override { calls.push_back(alpha ? "mask alpha" : "mask"); }
  void endMask() override { calls.push_back("end mask"); }
  void endMasked() override { calls.push_back("end masked"); }
  void clipToStroke(const ngn::SvgPath &p, const ngn::SvgStroke &s) override {
    calls.push_back("clip stroke " + path(p) + " w" + n(s.width));
  }
  void pattern(const ngn::SvgPatternTile &t, double opacity, const std::function<void(ngn::SvgCanvas &)> &drawTile) override {
    const auto &m = t.transform;
    calls.push_back(
        "pattern " + n(t.tile.x) + "," + n(t.tile.y) + " " + n(t.tile.width) + "x" + n(t.tile.height) + " t" + n(m.a) + "," + n(m.b) +
        "," + n(m.c) + "," + n(m.d) + "," + n(m.e) + "," + n(m.f) + (opacity != 1 ? " @" + n(opacity) : ""));
    calls.push_back("tile");
    drawTile(*this);
    calls.push_back("end tile");
  }
  static std::string step(const ngn::SvgFilterStep &s) {
    using T = ngn::SvgFilterStep::Type;
    std::ostringstream out;
    switch (s.type) {
      case T::GaussianBlur:
        out << "blur(" << s.in1 << " " << n(s.stdDeviationX) << "," << n(s.stdDeviationY);
        break;
      case T::Offset:
        out << "offset(" << s.in1 << " " << n(s.dx) << "," << n(s.dy);
        break;
      case T::ColorMatrix:
        out << "matrix(" << s.in1 << " " << n(s.matrix[0]) << "," << n(s.matrix[1]) << "," << n(s.matrix[2]);
        break;
      case T::Flood:
        out << "flood(#" << std::hex << s.argb << std::dec << " " << n(s.opacity);
        break;
      case T::Composite:
        out << "composite(" << s.in1 << " " << s.in2 << " op" << s.op;
        break;
      case T::Merge:
        out << "merge(";
        for (size_t i = 0; i < s.inputs.size(); ++i) {
          out << (i ? " " : "") << s.inputs[i];
        }
        break;
    }
    const auto &r = s.subregion;
    out << " in " << n(r.x) << "," << n(r.y) << " " << n(r.width) << "x" << n(r.height) << " >" << s.result << ")";
    return out.str();
  }
  void beginFilter(const ngn::SvgFilter &f) override {
    std::string line = "filter " + n(f.region.x) + "," + n(f.region.y) + " " + n(f.region.width) + "x" + n(f.region.height);
    for (const auto &s : f.steps) {
      line += " " + step(s);
    }
    calls.push_back(line);
  }
  void endFilter() override { calls.push_back("end filter"); }
  void image(const std::string &uri, const ngn::SvgRect &r, const std::string &align, int meetOrSlice, double opacity) override {
    calls.push_back("image " + uri + " " + n(r.x) + "," + n(r.y) + " " + n(r.width) + "x" + n(r.height));
  }
  // Ten points a byte, so a test reads an advance from a string's length, less three for each "AV"
  // kerned together, so a run's advance is not the sum of its glyphs'.
  double measureText(const std::string &text, double fontSize, const std::string &family, const std::string &weight) override {
    double kerned = 0;
    for (size_t at = text.find("AV"); at != std::string::npos; at = text.find("AV", at + 1)) {
      kerned += 3;
    }
    return static_cast<double>(text.size()) * 10 - kerned;
  }
  // A crude stand-in for grapheme clusters: an ASCII byte and the bytes of any characters that are
  // not ASCII after it, each placed where it ends in the run less its own advance.
  std::vector<ngn::SvgGlyphCluster> glyphClusters(
      const std::string &text, double fontSize, const std::string &family, const std::string &weight) override {
    std::vector<ngn::SvgGlyphCluster> out;
    for (size_t i = 0; i < text.size(); ++i) {
      if (out.empty() || static_cast<uint8_t>(text[i]) < 0x80) {
        out.push_back({});
      }
      out.back().text += text[i];
      if (i + 1 == text.size() || static_cast<uint8_t>(text[i + 1]) < 0x80) {
        auto &c = out.back();
        c.advance = measureText(c.text, fontSize, family, weight);
        c.x = measureText(text.substr(0, i + 1), fontSize, family, weight) - c.advance;
      }
    }
    return out;
  }
  void glyphCluster(const ngn::SvgGlyphCluster &cluster, double x, double y, const ngn::SvgPaint &fill) override {
    calls.push_back("glyphs '" + cluster.text + "' " + n(x) + "," + n(y) + " " + paint(fill));
  }
  void text(
      const std::string &text,
      double x,
      double y,
      double fontSize,
      const std::string &family,
      const std::string &weight,
      const ngn::SvgPaint &fill) override {
    calls.push_back("text '" + text + "' " + n(x) + "," + n(y) + " " + n(fontSize) + " " + paint(fill));
  }

  // The calls that draw, without the state around them.
  std::vector<std::string> drawn() const {
    std::vector<std::string> out;
    for (const auto &c : calls) {
      if (c.rfind("fill", 0) == 0 || c.rfind("stroke", 0) == 0 || c.rfind("text", 0) == 0 || c.rfind("image", 0) == 0 ||
          c.rfind("clip", 0) == 0) {
        out.push_back(c);
      }
    }
    return out;
  }
};

} // namespace
