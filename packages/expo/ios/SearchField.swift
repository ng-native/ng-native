import ExpoModulesCore
import UIKit

/**
 `<search-field>`: UIKit's search bar as a view of its own, for a search field outside a navigation
 bar. The text is controlled from JavaScript, and a text older than what has been typed since is
 skipped, as React Native's text input skips one.
 */
public final class SearchFieldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeSearchField")

    View(SearchFieldView.self) {
      Events("onChangeText", "onSubmitSearch", "onPressCancel", "onBeginEditing", "onEndEditing")

      Prop("text") { (view: SearchFieldView, text: String?) in
        view.text = text ?? ""
      }
      Prop("mostRecentEventCount") { (view: SearchFieldView, count: Int?) in
        view.mostRecentEventCount = count ?? 0
      }
      Prop("placeholder") { (view: SearchFieldView, placeholder: String?) in
        view.searchBar.placeholder = placeholder
      }
      Prop("showsCancelButton") { (view: SearchFieldView, shows: Bool?) in
        view.showsCancelButton = shows
      }
      Prop("autoCapitalize") { (view: SearchFieldView, value: String?) in
        view.searchBar.autocapitalizationType = switch value {
        case "words": .words
        case "sentences": .sentences
        case "characters": .allCharacters
        default: .none
        }
      }
      Prop("tintColor") { (view: SearchFieldView, color: UIColor?) in
        view.searchBar.tintColor = color
      }

      AsyncFunction("focus") { (view: SearchFieldView) in
        view.searchBar.becomeFirstResponder()
      }.runOnQueue(.main)
      AsyncFunction("blur") { (view: SearchFieldView) in
        view.searchBar.resignFirstResponder()
      }.runOnQueue(.main)
    }
  }
}

final class SearchFieldView: ExpoView, UISearchBarDelegate {
  let searchBar = UISearchBar()
  let onChangeText = EventDispatcher()
  let onSubmitSearch = EventDispatcher()
  let onPressCancel = EventDispatcher()
  let onBeginEditing = EventDispatcher()
  let onEndEditing = EventDispatcher()

  /// Changes the user has made, counted; JavaScript sends back the count its text answers.
  private var eventCount = 0
  var mostRecentEventCount = 0 {
    didSet { applyText() }
  }
  var text = "" {
    didSet { applyText() }
  }
  /// Nil shows the Cancel button while the field has the keyboard.
  var showsCancelButton: Bool? {
    didSet { searchBar.setShowsCancelButton(showsCancelButton ?? searchBar.isFirstResponder, animated: false) }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    searchBar.searchBarStyle = .minimal
    searchBar.delegate = self
    addSubview(searchBar)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    searchBar.frame = bounds
  }

  /// Puts JavaScript's text in the field, unless it answers a keystroke older than the last one.
  private func applyText() {
    guard mostRecentEventCount >= eventCount, searchBar.text != text else { return }
    searchBar.text = text
  }

  private func changed(_ text: String) {
    eventCount += 1
    onChangeText(["text": text, "eventCount": eventCount])
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    changed(searchText)
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    onSubmitSearch(["text": searchBar.text ?? ""])
    searchBar.resignFirstResponder()
  }

  func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
    if !(searchBar.text ?? "").isEmpty {
      searchBar.text = ""
      changed("")
    }
    onPressCancel()
    searchBar.resignFirstResponder()
  }

  func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) {
    if showsCancelButton == nil { searchBar.setShowsCancelButton(true, animated: true) }
    onBeginEditing()
  }

  func searchBarTextDidEndEditing(_ searchBar: UISearchBar) {
    if showsCancelButton == nil { searchBar.setShowsCancelButton(false, animated: true) }
    onEndEditing()
  }
}
