import Foundation

/// Блоки Markdown ответа агента, включая картинки. Строчное оформление разбирает AttributedString.
public enum ChatMarkdownBlock: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case image(alt: String, address: String, title: String?)
    case bulletList([String])
    case numberedList(start: Int, items: [String])
    case quote(String)
    case code(language: String?, text: String)
}

/// Разбор по строкам. Незакрытый блок кода — это код до конца текста: ответ ещё пишется.
public enum ChatMarkdown {
    public static func parse(_ markdown: String) -> [ChatMarkdownBlock] {
        var builder = Builder()
        var lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false)[...]
        while let raw = lines.popFirst() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                builder.flush()
                let language = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var code: [Substring] = []
                while let next = lines.popFirst(), !next.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(next)
                }
                builder.blocks.append(.code(language: language.isEmpty ? nil : language, text: code.joined(separator: "\n")))
            } else if line.isEmpty {
                builder.flush()
            } else if let heading = heading(line) {
                builder.flush()
                builder.blocks.append(heading)
            } else if let item = bullet(line) {
                builder.addBullet(item)
            } else if let (number, item) = numbered(line) {
                builder.addNumbered(item, number: number)
            } else if line.hasPrefix(">") {
                builder.addQuote(line.dropFirst().trimmingCharacters(in: .whitespaces))
            } else {
                builder.addParagraphLine(line, continuesItem: raw.first == " ")
            }
        }
        builder.flush()
        return builder.blocks.flatMap { block in
            if case let .paragraph(text) = block { return imageBlocks(in: text) }
            return [block]
        }
    }

    /// Complete inline images become blocks; unfinished syntax and code spans stay text.
    /// Destinations are passed verbatim to the host (including Mac paths).
    public static func imageBlocks(in text: String) -> [ChatMarkdownBlock] {
        let chars = Array(text)
        var result: [ChatMarkdownBlock] = []
        var start = 0, cursor = 0
        func escaped(_ index: Int) -> Bool {
            var i = index, count = 0
            while i > 0 && chars[i - 1] == "\\" { count += 1; i -= 1 }
            return count % 2 == 1
        }
        while cursor < chars.count {
            if chars[cursor] == "`", !escaped(cursor) {
                var end = cursor
                while end < chars.count && chars[end] == "`" { end += 1 }
                let fence = String(chars[cursor..<end])
                let remainder = String(chars[end...])
                if let range = remainder.range(of: fence) {
                    cursor = end + remainder.distance(from: remainder.startIndex, to: range.upperBound)
                    continue
                }
                // Unfinished inline code is streaming text, not an image.
                break
            }
            guard chars[cursor] == "!", !escaped(cursor), cursor + 1 < chars.count, chars[cursor + 1] == "[" else { cursor += 1; continue }
            let imageStart = cursor
            var close = cursor + 2
            while close < chars.count && (chars[close] != "]" || escaped(close)) { close += 1 }
            guard close + 1 < chars.count, chars[close + 1] == "(" else { cursor += 1; continue }
            var i = close + 2
            while i < chars.count && chars[i].isWhitespace { i += 1 }
            let angled = i < chars.count && chars[i] == "<"
            if angled { i += 1 }
            let addressStart = i
            var depth = 0
            while i < chars.count {
                let ch = chars[i]
                if !escaped(i) {
                    if angled && ch == ">" { break }
                    if !angled {
                        if ch == "(" { depth += 1 }
                        if ch == ")" { if depth == 0 { break }; depth -= 1 }
                        if ch.isWhitespace && depth == 0 { break }
                    }
                }
                i += 1
            }
            guard i > addressStart, i < chars.count, depth == 0 else { cursor += 1; continue }
            let address = String(chars[addressStart..<i])
            if angled {
                guard chars[i] == ">" else { cursor += 1; continue }
                i += 1
            }
            let beforeSpace = i
            while i < chars.count && chars[i].isWhitespace { i += 1 }
            var title: String?
            if i > beforeSpace, i < chars.count, chars[i] == "\"" || chars[i] == "'" {
                let quote = chars[i]; i += 1
                let titleStart = i
                while i < chars.count && (chars[i] != quote || escaped(i)) { i += 1 }
                guard i < chars.count else { cursor += 1; continue }
                title = String(chars[titleStart..<i]); i += 1
                while i < chars.count && chars[i].isWhitespace { i += 1 }
            }
            guard i < chars.count, chars[i] == ")" else { cursor += 1; continue }
            if start < imageStart {
                let prefix = String(chars[start..<imageStart]).trimmingCharacters(in: .newlines)
                if !prefix.isEmpty { result.append(.paragraph(prefix)) }
            }
            result.append(.image(alt: String(chars[(imageStart + 2)..<close]), address: address, title: title))
            cursor = i + 1; start = cursor
        }
        if start < chars.count {
            let suffix = String(chars[start...]).trimmingCharacters(in: .newlines)
            if !suffix.isEmpty { result.append(.paragraph(suffix)) }
        }
        return result.isEmpty ? [.paragraph(text)] : result
    }

    private static func heading(_ line: String) -> ChatMarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        return .heading(level: hashes, text: line.dropFirst(hashes + 1).trimmingCharacters(in: .whitespaces))
    }

    private static func bullet(_ line: String) -> String? {
        guard let first = line.first, "-*+".contains(first), line.dropFirst().first == " " else { return nil }
        return line.dropFirst(2).trimmingCharacters(in: .whitespaces)
    }

    private static func numbered(_ line: String) -> (Int, String)? {
        let digits = line.prefix { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty, digits.count < 10, let number = Int(digits) else { return nil }
        let rest = line.dropFirst(digits.count)
        guard let mark = rest.first, mark == "." || mark == ")", rest.dropFirst().first == " " else { return nil }
        return (number, rest.dropFirst(2).trimmingCharacters(in: .whitespaces))
    }

    private struct Builder {
        enum Open {
            case paragraph([String])
            case bullets([String])
            case numbers(start: Int, [String])
            case quote([String])
        }

        var blocks: [ChatMarkdownBlock] = []
        var open: Open?

        mutating func flush() {
            switch open {
            case let .paragraph(lines): blocks.append(.paragraph(lines.joined(separator: "\n")))
            case let .bullets(items): blocks.append(.bulletList(items))
            case let .numbers(start, items): blocks.append(.numberedList(start: start, items: items))
            case let .quote(lines): blocks.append(.quote(lines.joined(separator: "\n")))
            case nil: break
            }
            open = nil
        }

        mutating func addBullet(_ item: String) {
            if case var .bullets(items) = open { items.append(item); open = .bullets(items); return }
            flush()
            open = .bullets([item])
        }

        mutating func addNumbered(_ item: String, number: Int) {
            if case .numbers(let start, var items) = open { items.append(item); open = .numbers(start: start, items); return }
            flush()
            open = .numbers(start: number, [item])
        }

        mutating func addQuote(_ line: String) {
            if case var .quote(lines) = open { lines.append(line); open = .quote(lines); return }
            flush()
            open = .quote([line])
        }

        /// Строка с отступом под пунктом списка продолжает этот пункт.
        mutating func addParagraphLine(_ line: String, continuesItem: Bool) {
            switch open {
            case var .paragraph(lines):
                lines.append(line)
                open = .paragraph(lines)
            case var .bullets(items) where continuesItem:
                items[items.count - 1] += "\n" + line
                open = .bullets(items)
            case .numbers(let start, var items) where continuesItem:
                items[items.count - 1] += "\n" + line
                open = .numbers(start: start, items)
            default:
                flush()
                open = .paragraph([line])
            }
        }
    }
}
