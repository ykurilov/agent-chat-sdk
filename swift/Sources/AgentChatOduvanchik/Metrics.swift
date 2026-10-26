import SwiftUI
import YKDesign

// Части чата «Одуванчика» для iPhone. Зависят только от SwiftUI и YKDesign и ничего не знают
// о приложении: компоненты переиспользуются через AgentChatOduvanchik.
// Образец облика — explorations/chat-parts в репозитории дизайн-системы.

/// Размеры чата из переменных «Одуванчика».
public enum AgentChatMetrics {
    /// Пузырь сообщения пользователя.
    public static let bubbleRadius = YKTokens.Radius.message
    public static let bubbleHorizontalPadding = YKTokens.Space.s4
    public static let bubbleVerticalPadding = YKTokens.Space.s3 - 2
    /// Пузырь не шире этой доли колонки.
    public static let bubbleMaxWidthShare: CGFloat = 0.85
    /// Поле ввода внизу экрана.
    public static let composerRadius = YKTokens.Radius.composer
    public static let sendButtonSide: CGFloat = 40
    /// Поля колонки беседы от краёв экрана.
    public static let columnPadding = YKTokens.Space.s5
    /// После ответа агента и после сообщения пользователя.
    public static let replySpacing = YKTokens.Space.s6
    public static let userSpacing = YKTokens.Space.s8
    public static let headerHeight: CGFloat = 58
}
