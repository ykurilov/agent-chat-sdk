import XCTest
import AgentChatClient
import AgentChatOduvanchik

final class PresentationTests: XCTestCase {
    func testUnknownSourceResolutionNeverPretendsSubmittedIntentWasAllowed() {
        var permission = ChatPermission(id: "p", name: "Read", kind: "tool", actions: [.init(id: "yes", label: "Один раз", behavior: "allow")], status: "resolved", decision: .init(actionId: "yes"))
        XCTAssertEqual(PermissionPresentation.answerLabel(permission), "Выбор неизвестен")
        permission.resolution = .init(behavior: "allow", selectedActionId: "yes")
        XCTAssertEqual(PermissionPresentation.answerLabel(permission), "Один раз")
        permission.resolution = .init(behavior: "deny", message: "Позже")
        XCTAssertEqual(PermissionPresentation.answerLabel(permission), "Отказано")
        XCTAssertEqual(PermissionPresentation.text(.array([.string("a"), .string("b")])), "a, b")
    }
    func testStreamingMarkdownAndBlockStructure() {
        XCTAssertEqual(ChatMarkdown.parse("# Заголовок\n\n- **Первый**\n- Второй\n\n> Цитата\n\n```swift\nlet value = 1"), [
            .heading(level: 1, text: "Заголовок"), .bulletList(["**Первый**", "Второй"]), .quote("Цитата"), .code(language: "swift", text: "let value = 1")
        ])
        XCTAssertEqual(ChatMarkdown.parse("3. Третий\n4. Четвёртый\n\nТекст [ссылки](https://example.com)"), [.numberedList(start: 3, items: ["Третий", "Четвёртый"]), .paragraph("Текст [ссылки](https://example.com)")])
    }
    func testMarkdownImagesPreserveDestinationCaptionAndSurroundingText() {
        XCTAssertEqual(ChatMarkdown.parse("До ![Снимок](/tmp/sdk-images/x.png) после"), [
            .paragraph("До "), .image(alt: "Снимок", address: "/tmp/sdk-images/x.png", title: nil), .paragraph(" после")
        ])
        for address in ["/tmp/a.png", "file:///tmp/a.png", "~/shots/a.png", "https://example.com/a(1).png?q=1"] {
            XCTAssertEqual(ChatMarkdown.parse("![Подпись](\(address) \"Заголовок\")"), [.image(alt: "Подпись", address: address, title: "Заголовок")])
        }
        XCTAssertEqual(ChatMarkdown.parse("![](<https://example.com/a b.png>)"), [.image(alt: "", address: "https://example.com/a b.png", title: nil)])
        XCTAssertEqual(ChatMarkdown.parse("![a](/a.png)\n![b](/b.png)"), [.image(alt: "a", address: "/a.png", title: nil), .image(alt: "b", address: "/b.png", title: nil)])
    }

    func testStreamingImagesAndCodeRemainTextUntilComplete() {
        for value in ["![a](/tmp/a", "![a](/a \"title", "![a]", "`![a](/a.png)`", "\\![a](/a.png)", "![a](/a.png \"title\""] {
            XCTAssertEqual(ChatMarkdown.parse(value), [.paragraph(value)], value)
        }
        XCTAssertEqual(ChatMarkdown.parse("```\n![a](/a.png)\n```"), [.code(language: nil, text: "![a](/a.png)")])
        XCTAssertEqual(ChatMarkdown.imageBlocks(in: "пункт ![a](/a.png)"), [.paragraph("пункт "), .image(alt: "a", address: "/a.png", title: nil)])
    }

}
