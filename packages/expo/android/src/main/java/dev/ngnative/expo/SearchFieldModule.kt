package dev.ngnative.expo

import android.content.Context
import android.view.inputmethod.InputMethodManager
import androidx.appcompat.widget.SearchView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
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
      Prop("placeholder") { view: SearchFieldView, placeholder: String? ->
        view.search.queryHint = placeholder
      }

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

  /** Puts JavaScript's text in the field, unless it answers a keystroke older than the last one. */
  private fun applyText() {
    if (mostRecentEventCount < eventCount || search.query.toString() == text) return
    applying = true
    search.setQuery(text, false)
    applying = false
  }

  fun focus() {
    search.requestFocus()
    val input = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    input.showSoftInput(search.findFocus(), InputMethodManager.SHOW_IMPLICIT)
  }
}
