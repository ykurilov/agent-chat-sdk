#if canImport(UIKit)
import SwiftUI
import UIKit
import YKDesign

/// A single text container owns draft and provisional speech. Recoloring a final
/// never replaces its characters or switches layout engines at session boundaries.
struct AgentChatInlineDictationInput: View {
    @Binding var text: String
    @Binding var focused: Bool
    let draftSnapshot: String
    let displayText: String
    let placeholder: String
    let active: Bool
    let enabled: Bool
    let onNeedsProjection: () -> Void
    @ScaledMetric(relativeTo: .body) private var fontSize = YKTokens.Text.body.size
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var height: CGFloat = 24
    @State private var reservedHeight: CGFloat = 0

    var body: some View {
        InlineTextEditor(text: $text, focused: $focused, draftSnapshot: draftSnapshot, displayText: displayText,
                         placeholder: placeholder, fontSize: fontSize, enabled: enabled, onNeedsProjection: onNeedsProjection,
                         textColor: UIColor(YKColorRole.text.color), mutedColor: UIColor(YKColorRole.muted.color),
                         accentColor: UIColor(YKColorRole.accent.color)) { natural in
            let next = active ? max(reservedHeight, natural) : natural
            if active, next > reservedHeight { reservedHeight = next }
            guard abs(next - height) > 0.25 else { return }
            withAnimation(reduceMotion ? nil : .ykOut(duration: 0.18)) { height = next }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: height, alignment: .topLeading)
        .onChange(of: active) { _, value in reservedHeight = value ? height : 0 }
    }
}

private struct InlineTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    let draftSnapshot: String
    let displayText: String
    let placeholder: String
    let fontSize: CGFloat
    let enabled: Bool
    let onNeedsProjection: () -> Void
    let textColor: UIColor
    let mutedColor: UIColor
    let accentColor: UIColor
    let onHeight: (CGFloat) -> Void

    func makeUIView(context: Context) -> InlineTextView {
        let view = InlineTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.textContainer.heightTracksTextView = false
        view.layoutManager.usesFontLeading = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityIdentifier = "composer"
        return view
    }
    static func dismantleUIView(_ view: InlineTextView, coordinator: Coordinator) {
        coordinator.isMounted = false
        view.delegate = nil
        view.onHeight = nil
        view.unmarkText()
        view.resignFirstResponder()
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func updateUIView(_ view: InlineTextView, context: Context) {
        let coordinator = context.coordinator
        let staleNativeEcho = draftSnapshot != coordinator.confirmedText && coordinator.pendingNativeDrafts.contains(draftSnapshot)
        let externalDraftChanged = !staleNativeEcho && draftSnapshot != coordinator.confirmedText
        if externalDraftChanged || !enabled || !focused {
            coordinator.suppressChanges = true
            view.unmarkText()
            coordinator.suppressChanges = false
        }
        coordinator.parent = self
        view.onHeight = onHeight
        let font = UIFont.systemFont(ofSize: fontSize, weight: .regular)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = YKTextMetrics.lineSpacing(YKTokens.Text.body, size: fontSize)
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineBreakStrategy = []
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: textColor, .paragraphStyle: paragraph]
        let rendered = NSMutableAttributedString(string: displayText, attributes: attributes)
        let confirmed = min((draftSnapshot as NSString).length, rendered.length)
        if confirmed < rendered.length { rendered.addAttribute(.foregroundColor, value: mutedColor, range: NSRange(location: confirmed, length: rendered.length - confirmed)) }
        view.isEditable = enabled; view.isSelectable = enabled
        if !enabled { view.unmarkText(); if view.isFirstResponder { view.resignFirstResponder() } }
        if focused, enabled, !view.isFirstResponder { view.becomeFirstResponder() }
        else if !focused, view.isFirstResponder { view.resignFirstResponder() }
        // A SwiftUI render can arrive after another native keystroke. Its paired
        // draft/display snapshot must not replace a newer prefix already on screen.
        if staleNativeEcho {
            coordinator.scheduleReconciliation()
            return
        }
        let previousConfirmedText = coordinator.confirmedText
        coordinator.confirmedText = draftSnapshot
        coordinator.pendingNativeDrafts.removeAll()
        if view.markedTextRange != nil { return }
        context.coordinator.provisionalSuffix = (displayText as NSString).substring(from: confirmed)
        let selection = context.coordinator.pendingSelection.map { NSRange(location: $0, length: 0) } ?? view.selectedRange
        context.coordinator.pendingSelection = nil
        if view.text != displayText {
            view.attributedText = rendered
        } else if view.attributedText != rendered {
            // Same text at partial -> final: change attributes in place, preserving layout/selection.
            view.textStorage.beginEditing()
            view.textStorage.setAttributes(attributes, range: NSRange(location: 0, length: rendered.length))
            if confirmed < rendered.length { view.textStorage.addAttribute(.foregroundColor, value: mutedColor, range: NSRange(location: confirmed, length: rendered.length - confirmed)) }
            view.textStorage.endEditing()
        }
        // A final appends to the confirmed prefix without changing the visible
        // partial text. Follow that append only when the caret was at the old end;
        // an intentional interior caret or selection remains where the user put it.
        let previousEnd = (previousConfirmedText as NSString).length
        let followsAppend = selection.length == 0 && selection.location == previousEnd
            && confirmed > previousEnd && draftSnapshot.hasPrefix(previousConfirmedText)
        let location = followsAppend ? confirmed : min(selection.location, confirmed)
        view.selectedRange = NSRange(location: location, length: min(selection.length, confirmed - location))
        view.font = font; view.typingAttributes = attributes
        view.placeholder.font = font; view.placeholder.textColor = mutedColor
        view.placeholder.text = placeholder; view.placeholder.isHidden = !displayText.isEmpty
        view.accessibilityLabel = placeholder
        view.tintColor = accentColor
        view.reportHeight()
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: InlineTextEditor
        var pendingSelection: Int?
        var provisionalSuffix = ""
        var confirmedText: String
        var suppressChanges = false
        var pendingNativeDrafts: Set<String> = []
        var isMounted = true
        private var reconciliationScheduled = false
        init(_ parent: InlineTextEditor) { self.parent = parent; confirmedText = parent.draftSnapshot }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.focused = true }
        func textViewDidEndEditing(_ textView: UITextView) { parent.focused = false }
        func textViewDidChange(_ textView: UITextView) {
            guard parent.enabled, !suppressChanges else { return }
            let value = textView.text ?? ""
            if provisionalSuffix.isEmpty { publishNativeDraft(value) }
            else if value.hasSuffix(provisionalSuffix) { publishNativeDraft(String(value.dropLast(provisionalSuffix.count))) }
            (textView as? InlineTextView)?.reportHeight()
        }
        private func publishNativeDraft(_ value: String) {
            // Binding getters belong to the last SwiftUI projection and may lag
            // consecutive native keyboard events. Keep their current prefix locally.
            if value != confirmedText { pendingNativeDrafts.insert(confirmedText) }
            confirmedText = value
            parent.text = value
            scheduleReconciliation()
        }
        func scheduleReconciliation() {
            guard !reconciliationScheduled else { return }
            reconciliationScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                reconciliationScheduled = false
                // Read outside SwiftUI's render transaction. An explicit external
                // clear/replacement can equal an older native prefix; request a fresh
                // root snapshot rather than permanently treating that intent as stale.
                guard isMounted, parent.text != confirmedText else { return }
                pendingNativeDrafts.removeAll()
                parent.onNeedsProjection()
            }
        }
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
            guard parent.enabled else { return false }
            let confirmed = confirmedText as NSString
            if provisionalSuffix.isEmpty || (range.location <= confirmed.length && range.length <= confirmed.length - range.location) { return true }
            // Provisional speech remains outside the durable draft, including paste/select-all edits.
            let start = min(range.location, confirmed.length)
            let length = min(range.length, confirmed.length - start)
            publishNativeDraft(confirmed.replacingCharacters(in: NSRange(location: start, length: length), with: replacement))
            // Apply the native edit immediately: consecutive keyboard events must not
            // reuse the old selection while SwiftUI schedules the next projection.
            let inserted = NSRange(location: start, length: (replacement as NSString).length)
            textView.textStorage.replaceCharacters(in: NSRange(location: start, length: length), with: replacement)
            textView.textStorage.addAttributes(textView.typingAttributes, range: inserted)
            pendingSelection = start + inserted.length
            textView.selectedRange = NSRange(location: start + inserted.length, length: 0)
            return false
        }
    }
}

private final class InlineTextView: UITextView {
    let placeholder = UILabel()
    var onHeight: ((CGFloat) -> Void)?
    private var scheduled = false
    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        addSubview(placeholder)
        isScrollEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        placeholder.frame = CGRect(x: 0, y: 0, width: bounds.width, height: font?.lineHeight ?? 24)
        reportHeight()
    }
    func reportHeight() {
        guard bounds.width > 0, !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }; scheduled = false
            if abs(textContainer.size.width - bounds.width) > 0.25 || textContainer.size.height != .greatestFiniteMagnitude {
                textContainer.size = CGSize(width: bounds.width, height: .greatestFiniteMagnitude)
            }
            layoutManager.ensureLayout(for: textContainer)
            let line = (font?.lineHeight ?? 24) + YKTextMetrics.lineSpacing(YKTokens.Text.body, size: font?.pointSize ?? 15)
            let natural = ceil(max(font?.lineHeight ?? 24, layoutManager.usedRect(for: textContainer).height))
            let cap = ceil(line * 6)
            isScrollEnabled = natural > cap
            onHeight?(min(natural, cap))
        }
    }
}
#endif
