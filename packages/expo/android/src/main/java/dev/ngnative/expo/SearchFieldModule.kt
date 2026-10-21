package dev.ngnative.expo

import android.content.Context
import android.util.TypedValue
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import androidx.appcompat.widget.SearchView
import com.facebook.react.views.text.ReactTypefaceUtils
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.types.Either
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * `<search-field>`: AndroidX's search view, always open, for a search field outside a toolbar. The
 * text is controlled from JavaScript, and a text older than what has been typed since is skipped,
 * as React Native's text input skips one. Android's search field has no Cancel button.
 */
class SearchFieldModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NgNativeSearchField")

    View(SearchFieldView::class) {
      Events("onChangeText", "onSubmitSearch", "onPressCancel", "onBeginEditing", "onEndEditing")

      Prop("text") { view: SearchFieldView, text: String? -> view.text = text ?: "" }
      Prop("mostRecentEventCount") { view: SearchFieldView, count: Int? ->
        view.mostRecentEventCount = count ?: 0
      }
      Prop("enabled") { view: SearchFieldView, enabled: Boolean? -> view.fieldEnabled = enabled ?: true }
      Prop("placeholder") { view: SearchFieldView, placeholder: String? ->
        view.search.queryHint = placeholder
      }
      // The face and size the field's CSS resolves to, as a text's: the face by the name expo-font
      // registers it under.
      Prop("fontFamily") { view: SearchFieldView, family: String? -> view.fontFamily = family }
      Prop("fontSize") { view: SearchFieldView, size: Double? -> view.fontSize = size?.toFloat() }
      // A weight and a slant no matched face already draws: a number, or `normal` and `bold`.
      Prop("fontWeight") { view: SearchFieldView, weight: Either<Double, String>? ->
        view.fontWeight = when {
          weight == null -> null
          weight.`is`(Double::class) -> weight.get(Double::class).toInt().toString()
          else -> weight.get(String::class)
        }
      }
      Prop("fontStyle") { view: SearchFieldView, style: String? -> view.fontStyle = style }

      AsyncFunction("focus") { view: SearchFieldView -> view.focus() }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
      AsyncFunction("blur") { view: SearchFieldView -> view.search.clearFocus() }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    }
  }
}

class SearchFieldView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onChangeText by EventDispatcher()
  private val onSubmitSearch by EventDispatcher()
  private val onBeginEditing by EventDispatcher()
  private val onEndEditing by EventDispatcher()

  /** Changes the user has made, counted; JavaScript sends back the count its text answers. */
  private var eventCount = 0
  /** Set while JavaScript's text goes in, so it is not reported back as typing. */
  private var applying = false

  var mostRecentEventCount = 0
    set(value) {
      field = value
      applyText()
    }
  var text = ""
    set(value) {
      field = value
      applyText()
    }

  val search = SearchView(context).apply {
    setIconifiedByDefault(false)
    setOnQueryTextListener(object : SearchView.OnQueryTextListener {
      override fun onQueryTextChange(newText: String): Boolean {
        if (applying) return true
        eventCount += 1
        onChangeText(mapOf("text" to newText, "eventCount" to eventCount))
        return true
      }

      override fun onQueryTextSubmit(query: String): Boolean {
        onSubmitSearch(mapOf("text" to query))
        clearFocus()
        return true
      }
    })
    setOnQueryTextFocusChangeListener { _, focused ->
      if (focused) onBeginEditing(mapOf()) else onEndEditing(mapOf())
    }
  }

  init {
    addView(search, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  /** The text box, and the face and size it starts with, put back when the CSS names none. */
  private val input = search.findViewById<TextView>(androidx.appcompat.R.id.search_src_text)
  private val systemTypeface = input?.typeface
  private val systemTextSize = input?.textSize

  var fontFamily: String? = null
    set(value) {
      field = value
      applyFont()
    }
  var fontSize: Float? = null
    set(value) {
      field = value
      applyFont()
    }
  var fontWeight: String? = null
    set(value) {
      field = value
      applyFont()
    }
  var fontStyle: String? = null
    set(value) {
      field = value
      applyFont()
    }

  /**
   * The CSS's face, weight and slant, found as a text's is, at its size in sp, so it scales with the
   * font size setting.
   */
  private fun applyFont() {
    val input = input ?: return
    input.typeface = ReactTypefaceUtils.applyStyles(
      systemTypeface,
      ReactTypefaceUtils.parseFontStyle(fontStyle),
      ReactTypefaceUtils.parseFontWeight(fontWeight),
      fontFamily,
      context.assets,
    )
    val size = fontSize
    if (size != null) input.setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    else if (systemTextSize != null) input.setTextSize(TypedValue.COMPLEX_UNIT_PX, systemTextSize)
  }

  /** Puts JavaScript's text in the field, unless it answers a keystroke older than the last one. */
  private fun applyText() {
    if (mostRecentEventCount < eventCount || search.query.toString() == text) return
    applying = true
    search.setQuery(text, false)
    applying = false
  }

  var fieldEnabled = true
    set(value) {
      field = value
      search.isEnabled = value
      // The text box and its clear button take touches of their own, so each is turned off too.
      search.findViewById<android.view.View>(androidx.appcompat.R.id.search_src_text)?.isEnabled = value
      search.findViewById<android.view.View>(androidx.appcompat.R.id.search_close_btn)?.isEnabled = value
      search.alpha = if (value) 1f else 0.5f
    }

  fun focus() {
    search.requestFocus()
    val input = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    input.showSoftInput(search.findFocus(), InputMethodManager.SHOW_IMPLICIT)
  }
}
