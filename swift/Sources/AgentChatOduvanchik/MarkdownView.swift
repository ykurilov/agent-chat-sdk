import SwiftUI
import YKDesign

/// Ответ агента в Markdown: заголовки, списки, цитаты, код; внутри строк — жирный, курсив, ссылки, `код`.
/// Пока ответ пишется, незакрытый блок кода показывается как код.
public struct AgentChatMarkdown: View {
    let blocks: [ChatMarkdownBlock]

    public init(_ markdown: String) {
        blocks = ChatMarkdown.parse(markdown)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s3) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .tint(YKColorRole.accentText.color)
    }

    @ViewBuilder
    private func view(for block: ChatMarkdownBlock) -> some View {
        switch block {
        case let .heading(level, text):
            Self.inline(text).ykText(level <= 2 ? .heading : .body, weight: 600)
                .foregroundStyle(YKColorRole.text.color)
                .padding(.top, YKTokens.Space.s1)
        case let .paragraph(text):
            Self.inline(text).ykText(.body).foregroundStyle(YKColorRole.text.color)
        case let .bulletList(items):
            list(items.map { ("•", $0) })
        case let .numberedList(start, items):
            list(items.enumerated().map { ("\(start + $0.offset).", $0.element) })
        case let .quote(text):
            Self.inline(text).ykText(.body).foregroundStyle(YKColorRole.muted.color)
                .padding(.leading, YKTokens.Space.s3)
                .overlay(alignment: .leading) {
                    Rectangle().fill(YKColorRole.borderStrong.color).frame(width: 2)
                }
        case let .code(_, text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(size: YKTokens.FontSize.small, design: .monospaced))
                    .foregroundStyle(YKColorRole.text.color)
                    .padding(YKTokens.Space.s3)
            }
            .background(YKColorRole.surface2.color, in: RoundedRectangle(cornerRadius: YKTokens.Radius.md, style: .continuous))
        }
    }

    private func list(_ items: [(mark: String, text: String)]) -> some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s2 - 2) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: YKTokens.Space.s2) {
                    Text(item.mark).ykText(.body).foregroundStyle(YKColorRole.muted.color)
                    Self.inline(item.text).ykText(.body).foregroundStyle(YKColorRole.text.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    /// Строчная разметка. Сломанная разметка (ответ ещё пишется) показывается как есть.
    static func inline(_ text: String) -> Text {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard var attributed = try? AttributedString(markdown: text, options: options) else { return Text(text) }
        for run in attributed.runs where run.inlinePresentationIntent?.contains(.code) == true {
            attributed[run.range].font = .system(size: YKTokens.FontSize.body - 1, design: .monospaced)
            attributed[run.range].backgroundColor = YKColorRole.surface2.color
        }
        return Text(attributed)
    }
}
