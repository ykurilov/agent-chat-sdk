import Foundation

/// Блоки Markdown ответа менеджера. Строчное оформление (жирный, ссылки, код) разбирает AttributedString.
public enum ChatMarkdownBlock: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
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
        return builder.blocks
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
