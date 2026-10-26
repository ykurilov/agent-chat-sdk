import Foundation
import AgentChatClient

/// Resolution text never treats a submitted intent or a missing source answer as an actual Allow.
public enum PermissionPresentation {
    public static func answerLabel(_ permission: ChatPermission) -> String {
        guard let resolution = permission.resolution else { return "Выбор неизвестен" }
        if let id = resolution.selectedActionId, let action = permission.actions?.first(where: { $0.id == id }) { return action.label }
        switch resolution.behavior { case "allow": return "Разрешено"; case "deny": return "Отказано"; default: return "Выбор неизвестен" }
    }
    public static func text(_ value: JSONValue) -> String {
        if let string = value.string { return string }
        if let array = value.array { return array.map(text).joined(separator: ", ") }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return (try? String(decoding: encoder.encode(value), as: UTF8.self)) ?? ""
    }
}
