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
}
