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
      Prop("enabled") { (view: SearchFieldView, enabled: Bool?) in
        let enabled = enabled ?? true
        // The text field and the Cancel button: disabled while it is edited, Cancel would still
        // empty the field.
        view.searchBar.isUserInteractionEnabled = enabled
        view.searchBar.searchTextField.isEnabled = enabled
        view.searchBar.alpha = enabled ? 1 : 0.5
        if !enabled { view.searchBar.resignFirstResponder() }
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
      // The face and size the field's CSS resolves to, as a text's: the face by its PostScript name.
      Prop("fontFamily") { (view: SearchFieldView, family: String?) in
        view.fontFamily = family
      }
      Prop("fontSize") { (view: SearchFieldView, size: Double?) in
        view.fontSize = size.map { CGFloat($0) }
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
  /// The field's own font, put back when the CSS names none.
  private lazy var systemFont = searchBar.searchTextField.font ?? .preferredFont(forTextStyle: .body)
  var fontFamily: String? {
    didSet { applyFont() }
  }
  var fontSize: CGFloat? {
    didSet { applyFont() }
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

  /// The CSS's face at its size, scaled with the text size setting as a text's is, or the field's
  /// own font when the CSS names neither. A name no face is registered under is looked up as a
  /// family; one the system does not have either keeps the field's own face.
  private func applyFont() {
    let field = searchBar.searchTextField
    guard fontFamily != nil || fontSize != nil else {
      field.adjustsFontForContentSizeCategory = false
      field.font = systemFont
      return
    }
    let size = fontSize ?? systemFont.pointSize
    var font = systemFont.withSize(size)
    if let family = fontFamily {
      if let named = UIFont(name: family, size: size) {
        font = named
      } else if !UIFont.fontNames(forFamilyName: family).isEmpty {
        font = UIFont(descriptor: UIFontDescriptor(fontAttributes: [.family: family]), size: size)
      }
    }
    field.font = UIFontMetrics.default.scaledFont(for: font)
    field.adjustsFontForContentSizeCategory = true
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
