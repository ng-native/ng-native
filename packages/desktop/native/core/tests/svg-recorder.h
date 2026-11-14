// A canvas that records each drawing call as a line, for tests of what the core draws.
#pragma once

#include "ngn/svg.h"

#include <cmath>
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
  void image(const std::string &uri, const ngn::SvgRect &r, const std::string &align, int meetOrSlice, double opacity) override {
    calls.push_back("image " + uri + " " + n(r.x) + "," + n(r.y) + " " + n(r.width) + "x" + n(r.height));
  }
  double text(
      const std::string &text,
      double x,
      double y,
      double fontSize,
      const std::string &family,
      const std::string &weight,
      const ngn::SvgPaint *fill) override {
    calls.push_back("text '" + text + "' " + n(x) + "," + n(y) + " " + n(fontSize) + (fill ? " " + paint(*fill) : ""));
    return static_cast<double>(text.size()) * 10;
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
