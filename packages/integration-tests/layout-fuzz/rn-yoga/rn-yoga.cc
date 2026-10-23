// React Native's own Yoga, the copy vendored in the react-native package this workspace builds
// against, as a Node addon: `layout(ops, texts)` lays out a tree and answers each node's box.
//
// The tree comes as numbers (see `yoga.ts`, which writes them):
//   header: screen width, screen height, errata (0 none, 1 all), point scale factor, node count
//   each node: parent index (-1 for the screen), text index (-1 for none), op count, then each op
//     as four numbers: op, edge or gutter, unit (0 point, 1 percent, 2 auto), value
// A node with a text is measured as the pipeline's fake text is, ten points a character and
// twenty a line, and its children are not laid out.
// The answer is four numbers a node: left and top against its parent, width and height.

#include <node_api.h>

#include <string>
#include <vector>

#include <yoga/Yoga.h>

namespace {

std::vector<std::string> texts;

constexpr float GLYPH = 10;
constexpr float LINE = 20;

YGSize measureText(YGNodeConstRef node, float width, YGMeasureMode mode, float, YGMeasureMode) {
  const auto& text = texts[reinterpret_cast<size_t>(YGNodeGetContext(node)) - 1];
  const bool bounded = mode != YGMeasureModeUndefined;
  float widest = 0;
  int count = 0;
  size_t start = 0;
  while (true) {
    size_t end = text.find('\n', start);
    std::string line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
    count += 1;
    float run = 0;
    size_t wordStart = 0;
    while (true) {
      size_t space = line.find(' ', wordStart);
      float size = GLYPH * static_cast<float>((space == std::string::npos ? line.size() : space) - wordStart);
      if (run > 0 && bounded && run + GLYPH + size > width) {
        count += 1;
        run = 0;
      }
      run += (run > 0 ? GLYPH : 0) + size;
      if (run > widest) widest = run;
      if (space == std::string::npos) break;
      wordStart = space + 1;
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return YGSize{widest, count * LINE};
}

YGEdge edgeOf(int edge) {
  static const YGEdge edges[] = {YGEdgeLeft, YGEdgeTop, YGEdgeRight, YGEdgeBottom, YGEdgeStart,
                                 YGEdgeEnd, YGEdgeHorizontal, YGEdgeVertical, YGEdgeAll};
  return edges[edge];
}

YGAlign alignOf(int value) {
  static const YGAlign aligns[] = {YGAlignAuto, YGAlignFlexStart, YGAlignCenter,
                                   YGAlignFlexEnd, YGAlignStretch, YGAlignBaseline,
                                   YGAlignSpaceBetween, YGAlignSpaceAround, YGAlignSpaceEvenly};
  return aligns[value];
}

void apply(YGNodeRef node, int op, int edge, int unit, float value) {
  switch (op) {
#define SIZE(code, name)                                    \
  case code:                                                \
    if (unit == 0) YGNodeStyleSet##name(node, value);       \
    else if (unit == 1) YGNodeStyleSet##name##Percent(node, value); \
    break;
#define SIZE_AUTO(code, name)                               \
  case code:                                                \
    if (unit == 0) YGNodeStyleSet##name(node, value);       \
    else if (unit == 1) YGNodeStyleSet##name##Percent(node, value); \
    else YGNodeStyleSet##name##Auto(node);                  \
    break;
    SIZE_AUTO(1, Width)
    SIZE_AUTO(2, Height)
    SIZE(3, MinWidth)
    SIZE(4, MinHeight)
    SIZE(5, MaxWidth)
    SIZE(6, MaxHeight)
    SIZE_AUTO(7, FlexBasis)
#undef SIZE
#undef SIZE_AUTO
    case 10:
      if (unit == 0) YGNodeStyleSetMargin(node, edgeOf(edge), value);
      else if (unit == 1) YGNodeStyleSetMarginPercent(node, edgeOf(edge), value);
      else YGNodeStyleSetMarginAuto(node, edgeOf(edge));
      break;
    case 11:
      if (unit == 0) YGNodeStyleSetPadding(node, edgeOf(edge), value);
      else YGNodeStyleSetPaddingPercent(node, edgeOf(edge), value);
      break;
    case 12:
      YGNodeStyleSetBorder(node, edgeOf(edge), value);
      break;
    case 13:
      if (unit == 0) YGNodeStyleSetPosition(node, edgeOf(edge), value);
      else YGNodeStyleSetPositionPercent(node, edgeOf(edge), value);
      break;
    case 14: {
      static const YGGutter gutters[] = {YGGutterColumn, YGGutterRow, YGGutterAll};
      if (unit == 0) YGNodeStyleSetGap(node, gutters[edge], value);
      else YGNodeStyleSetGapPercent(node, gutters[edge], value);
      break;
    }
    case 20: {
      static const YGPositionType types[] = {YGPositionTypeStatic, YGPositionTypeRelative,
                                             YGPositionTypeAbsolute};
      YGNodeStyleSetPositionType(node, types[static_cast<int>(value)]);
      break;
    }
    case 21: {
      static const YGFlexDirection directions[] = {YGFlexDirectionColumn,
                                                   YGFlexDirectionColumnReverse,
                                                   YGFlexDirectionRow, YGFlexDirectionRowReverse};
      YGNodeStyleSetFlexDirection(node, directions[static_cast<int>(value)]);
      break;
    }
    case 22: {
      static const YGWrap wraps[] = {YGWrapNoWrap, YGWrapWrap, YGWrapWrapReverse};
      YGNodeStyleSetFlexWrap(node, wraps[static_cast<int>(value)]);
      break;
    }
    case 23:
      YGNodeStyleSetFlex(node, value);
      break;
    case 24:
      YGNodeStyleSetFlexGrow(node, value);
      break;
    case 25:
      YGNodeStyleSetFlexShrink(node, value);
      break;
    case 26:
      YGNodeStyleSetAlignItems(node, alignOf(static_cast<int>(value)));
      break;
    case 27:
      YGNodeStyleSetAlignSelf(node, alignOf(static_cast<int>(value)));
      break;
    case 28:
      YGNodeStyleSetAlignContent(node, alignOf(static_cast<int>(value)));
      break;
    case 29: {
      static const YGJustify justifies[] = {YGJustifyFlexStart, YGJustifyCenter,
                                            YGJustifyFlexEnd, YGJustifySpaceBetween,
                                            YGJustifySpaceAround, YGJustifySpaceEvenly};
      YGNodeStyleSetJustifyContent(node, justifies[static_cast<int>(value)]);
      break;
    }
    case 30: {
      static const YGDisplay displays[] = {YGDisplayFlex, YGDisplayNone, YGDisplayContents};
      YGNodeStyleSetDisplay(node, displays[static_cast<int>(value)]);
      break;
    }
    case 31: {
      static const YGOverflow overflows[] = {YGOverflowVisible, YGOverflowHidden,
                                             YGOverflowScroll};
      YGNodeStyleSetOverflow(node, overflows[static_cast<int>(value)]);
      break;
    }
    case 32:
      YGNodeStyleSetAspectRatio(node, value);
      break;
    case 33:
      YGNodeStyleSetBoxSizing(node, value == 0 ? YGBoxSizingBorderBox : YGBoxSizingContentBox);
      break;
    case 34: {
      static const YGDirection directions[] = {YGDirectionInherit, YGDirectionLTR,
                                               YGDirectionRTL};
      YGNodeStyleSetDirection(node, directions[static_cast<int>(value)]);
      break;
    }
    default:
      break;
  }
}

napi_value layout(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void* data;
  size_t length;
  napi_typedarray_type type;
  napi_get_typedarray_info(env, argv[0], &type, &length, &data, nullptr, nullptr);
  const double* in = static_cast<const double*>(data);

  texts.clear();
  uint32_t textCount = 0;
  napi_get_array_length(env, argv[1], &textCount);
  for (uint32_t i = 0; i < textCount; i++) {
    napi_value item;
    napi_get_element(env, argv[1], i, &item);
    size_t size = 0;
    napi_get_value_string_utf8(env, item, nullptr, 0, &size);
    std::string text(size, '\0');
    napi_get_value_string_utf8(env, item, text.data(), size + 1, &size);
    texts.push_back(text);
  }

  size_t at = 0;
  const float width = static_cast<float>(in[at++]);
  const float height = static_cast<float>(in[at++]);
  const bool errata = in[at++] != 0;
  const float scale = static_cast<float>(in[at++]);
  const size_t count = static_cast<size_t>(in[at++]);

  YGConfigRef config = YGConfigNew();
  YGConfigSetErrata(config, errata ? YGErrataAll : YGErrataNone);
  YGConfigSetPointScaleFactor(config, scale);
  YGNodeRef root = YGNodeNewWithConfig(config);
  YGNodeStyleSetWidth(root, width);
  YGNodeStyleSetHeight(root, height);

  std::vector<YGNodeRef> nodes(count);
  for (size_t i = 0; i < count; i++) {
    const int parent = static_cast<int>(in[at++]);
    const int text = static_cast<int>(in[at++]);
    const size_t ops = static_cast<size_t>(in[at++]);
    YGNodeRef node = YGNodeNewWithConfig(config);
    for (size_t j = 0; j < ops; j++) {
      apply(node, static_cast<int>(in[at]), static_cast<int>(in[at + 1]),
            static_cast<int>(in[at + 2]), static_cast<float>(in[at + 3]));
      at += 4;
    }
    if (text >= 0) {
      YGNodeSetContext(node, reinterpret_cast<void*>(static_cast<size_t>(text) + 1));
      YGNodeSetMeasureFunc(node, measureText);
    }
    YGNodeRef owner = parent < 0 ? root : nodes[parent];
    YGNodeInsertChild(owner, node, YGNodeGetChildCount(owner));
    nodes[i] = node;
  }
  YGNodeCalculateLayout(root, YGUndefined, YGUndefined, YGDirectionLTR);

  napi_value buffer;
  void* outData;
  napi_create_arraybuffer(env, count * 4 * sizeof(double), &outData, &buffer);
  double* out = static_cast<double*>(outData);
  for (size_t i = 0; i < count; i++) {
    out[i * 4] = YGNodeLayoutGetLeft(nodes[i]);
    out[i * 4 + 1] = YGNodeLayoutGetTop(nodes[i]);
    out[i * 4 + 2] = YGNodeLayoutGetWidth(nodes[i]);
    out[i * 4 + 3] = YGNodeLayoutGetHeight(nodes[i]);
  }
  YGNodeFreeRecursive(root);
  YGConfigFree(config);
  napi_value result;
  napi_create_typedarray(env, napi_float64_array, count * 4, buffer, 0, &result);
  return result;
}

napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "layout", NAPI_AUTO_LENGTH, layout, nullptr, &fn);
  napi_set_named_property(env, exports, "layout", fn);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
