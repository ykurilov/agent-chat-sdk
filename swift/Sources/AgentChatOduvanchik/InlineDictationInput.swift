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
                         placeholder: placeholder, fontSize: fontSize, enabled: enabled, active: active, reduceMotion: reduceMotion, onNeedsProjection: onNeedsProjection,
                         textColor: UIColor(YKColorRole.text.color), mutedColor: UIColor(YKColorRole.muted.color),
                         accentColor: UIColor(YKColorRole.accent.color)) { natural in
            let next = max(reservedHeight, natural)
            guard abs(next - height) > 0.25 else { return }
            animateHeight(to: next)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: height, alignment: .topLeading)
        .onChange(of: active) { _, value in
            if value {
                // Open the bounded viewport once. A bottom-anchored composer must
                // not push the conversation upward on each dictated line.
                let line = UIFont.systemFont(ofSize: fontSize).lineHeight
                    + YKTextMetrics.lineSpacing(YKTokens.Text.body, size: fontSize)
                reservedHeight = max(height, ceil(line * 6))
                animateHeight(to: reservedHeight)
            } else { releaseEmptyReservation() }
        }
        .onChange(of: draftSnapshot) { _, _ in releaseEmptyReservation() }
    }
    private func releaseEmptyReservation() {
        guard !active, draftSnapshot.isEmpty else { return }
        reservedHeight = 0
        animateHeight(to: ceil(UIFont.systemFont(ofSize: fontSize).lineHeight))
    }
    private func animateHeight(to target: CGFloat) {
        // Keep the design-system easing, but allow a full viewport opening more
        // time than a single-line adjustment so its first frames do not jump.
        let duration = max(0.18, Double(abs(target - height)) / 200)
        withAnimation(reduceMotion ? nil : .ykOut(duration: duration)) { height = target }
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
    let active: Bool
    let reduceMotion: Bool
    let onNeedsProjection: () -> Void
    let textColor: UIColor
    let mutedColor: UIColor
    let accentColor: UIColor
    let onHeight: (CGFloat) -> Void

    func makeUIView(context: Context) -> InlineTextView {
        let view = InlineTextView()
        view.delegate = context.coordinator
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.appendTap(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        view.appendTap = tap
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
        view.retire()
        if let tap = view.appendTap { view.removeGestureRecognizer(tap) }
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
        view.configureTail(active: active, empty: displayText.isEmpty, confirmedEnd: (coordinator.confirmedText as NSString).length, reduceMotion: reduceMotion)
        let savedOffset = view.contentOffset
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
        if view.ownsSpeechViewport { view.setContentOffset(savedOffset, animated: false) }
        view.synchronizeTailLayout()
        view.reportHeight()
    }
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: InlineTextEditor
        var pendingSelection: Int?
        var provisionalSuffix = ""
        var confirmedText: String
        var suppressChanges = false
        var pendingNativeDrafts: Set<String> = []
        var isMounted = true
        private var reconciliationScheduled = false
        init(_ parent: InlineTextEditor) { self.parent = parent; confirmedText = parent.draftSnapshot }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.focused = true; appendAfterStop(textView) }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
        @objc func appendTap(_ gesture: UITapGestureRecognizer) {
            guard gesture.state == .ended, let view = gesture.view as? InlineTextView else { return }
            appendAfterStop(view)
        }
        private func appendAfterStop(_ textView: UITextView) {
            guard let view = textView as? InlineTextView, view.consumeAppendTap() else { return }
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, isMounted, parent.enabled, !parent.active else { return }
                let end = (confirmedText as NSString).length
                view.selectedRange = NSRange(location: min(end, (view.text as NSString).length), length: 0)
                view.followTail()
            }
        }
        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { (scrollView as? InlineTextView)?.beginManualScroll() }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate { (scrollView as? InlineTextView)?.endManualScroll() }
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { (scrollView as? InlineTextView)?.endManualScroll() }
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
    var retired = false
    weak var appendTap: UITapGestureRecognizer?
    private var speechActive = false
    private var retainsTail = false
    private var manualViewport = false
    private var appendOnTap = false
    private var reduceMotion = false
    private var scrollTarget: CGFloat = -1
    private var followDisplayLink: CADisplayLink?
    private var previousFollowTime: CFTimeInterval = 0
    func retire() { retired = true; stopFollowing() }
    private func stopFollowing() { followDisplayLink?.invalidate(); followDisplayLink = nil; previousFollowTime = 0 }
    var ownsSpeechViewport: Bool { retainsTail }
    func configureTail(active: Bool, empty: Bool, confirmedEnd: Int, reduceMotion: Bool) {
        self.reduceMotion = reduceMotion
        if active && !speechActive {
            retainsTail = true; manualViewport = false; appendOnTap = false
        } else if !active && speechActive {
            // Stop can flush the last partial and finish in one SwiftUI render.
            // Its old caret follows the confirmed prefix, not the preview suffix.
            appendOnTap = !manualViewport && selectedRange.length == 0 && selectedRange.location == confirmedEnd
        }
        speechActive = active
        if !active && empty {
            retainsTail = false; manualViewport = false; appendOnTap = false
            stopFollowing(); contentInset.bottom = 0; scrollTarget = -1
        }
    }
    func beginManualScroll() {
        guard retainsTail else { return }
        stopFollowing(); manualViewport = true; appendOnTap = false; scrollTarget = -1
        setContentOffset(contentOffset, animated: false)
    }
    func endManualScroll() {
        guard retainsTail else { return }
        let bottom = max(0, contentSize.height + adjustedContentInset.bottom - bounds.height)
        if bottom - contentOffset.y < 8 {
            manualViewport = false
            appendOnTap = !speechActive
            followTail()
        }
    }
    func consumeAppendTap() -> Bool {
        guard !speechActive, appendOnTap, !manualViewport else { return false }
        appendOnTap = false
        return true
    }
    // Native selection changes may otherwise scroll the confirmed caret away from
    // the provisional tail, or undo the viewport the reader chose by dragging.
    override func scrollRectToVisible(_ rect: CGRect, animated: Bool) {
        if retainsTail { return }
        super.scrollRectToVisible(rect, animated: animated)
    }
    func synchronizeTailLayout() {
        guard retainsTail, !retired, bounds.width > 0 else { return }
        textContainer.size = CGSize(width: bounds.width, height: .greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        let line = (font?.lineHeight ?? 24) + YKTextMetrics.lineSpacing(YKTokens.Text.body, size: font?.pointSize ?? 15)
        let natural = layoutManager.usedRect(for: textContainer).height
        let cap = ceil(line * 6)
        // Short text must not scroll while the reserved viewport is opening.
        // Add breathing room only when text approaches the six-line boundary.
        if natural + line > cap, bounds.height >= cap - 0.5 { contentInset.bottom = line }
        isScrollEnabled = natural + contentInset.bottom > cap
        followTail()
    }
    func followTail() {
        guard retainsTail, !manualViewport, !isDragging, !isDecelerating, !retired, bounds.height > 0 else { return }
        layoutManager.ensureLayout(for: textContainer)
        let line = (font?.lineHeight ?? 24) + YKTextMetrics.lineSpacing(YKTokens.Text.body, size: font?.pointSize ?? 15)
        guard bounds.height >= ceil(line * 6) - 0.5 else { return }
        let bottom = ceil(layoutManager.usedRect(for: textContainer).maxY)
        let target = max(0, bottom + contentInset.bottom - bounds.height)
        guard abs(target - scrollTarget) > 0.5 else { return }
        scrollTarget = target
        // Reserve a line ahead of the next wrap, and reconcile the viewport in
        // the same native update as the text, before a display frame can expose it.
        let minimum = max(0, bottom - bounds.height)
        if contentOffset.y < minimum { setContentOffset(CGPoint(x: 0, y: minimum), animated: false) }
        if reduceMotion {
            stopFollowing(); setContentOffset(CGPoint(x: 0, y: target), animated: false)
        } else if followDisplayLink == nil {
            let link = CADisplayLink(target: self, selector: #selector(followFrame(_:)))
            followDisplayLink = link
            link.add(to: .main, forMode: .common)
        }
    }
    @objc private func followFrame(_ link: CADisplayLink) {
        guard retainsTail, !manualViewport, !retired, !isDragging, !isDecelerating else { stopFollowing(); return }
        let elapsed = previousFollowTime == 0 ? link.duration : min(0.05, link.timestamp - previousFollowTime)
        previousFollowTime = link.timestamp
        let distance = scrollTarget - contentOffset.y
        let step = max(1, 200 * elapsed)
        if abs(distance) <= step {
            setContentOffset(CGPoint(x: 0, y: scrollTarget), animated: false)
            stopFollowing()
        } else {
            setContentOffset(CGPoint(x: 0, y: contentOffset.y + (distance > 0 ? step : -step)), animated: false)
        }
    }
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
        guard !retired, bounds.width > 0, !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self, !retired else { return }; scheduled = false
            if abs(textContainer.size.width - bounds.width) > 0.25 || textContainer.size.height != .greatestFiniteMagnitude {
                textContainer.size = CGSize(width: bounds.width, height: .greatestFiniteMagnitude)
            }
            layoutManager.ensureLayout(for: textContainer)
            let line = (font?.lineHeight ?? 24) + YKTextMetrics.lineSpacing(YKTokens.Text.body, size: font?.pointSize ?? 15)
            let natural = ceil(max(font?.lineHeight ?? 24, layoutManager.usedRect(for: textContainer).height))
            let cap = ceil(line * 6)
            if retainsTail, natural + line > cap, bounds.height >= cap - 0.5 { contentInset.bottom = line }
            isScrollEnabled = natural + contentInset.bottom > cap
            onHeight?(min(natural, cap))
            followTail()
        }
    }
}
#endif
