# Проверка диктовки на iPhone

Приложение использует локальный пакет из корня SDK и синтетический распознаватель без микрофона или платного API. Установите `AGENT_CHAT_YKDESIGN_PATH` на канонический пакет YKDesign и запустите схему AgentChatNativeFixture на отдельном iPhone simulator через xcodebuild test (параллелизм 1, jobs 2).

UI-тест проверяет светлую и тёмную тему: preview/final/subword, ведущий разделитель и скрытую подсказку, замену выделенного слова при обновлении partial. CADisplayLink измеряет ширину редактора, локальные координаты подтверждённого префикса и покадровую высоту. Рост в несколько строк должен давать промежуточные кадры вместо скачка на всю строку. Для видео используйте simctl io <свой simulator-id> recordVideo; чужие симуляторы не затрагивайте.

Быстрые правки за один цикл событий воспроизводят договор клавиатуры: shouldChangeTextIn → insertText при разрешении → textViewDidChange. Низкоуровневый insertText сам по себе не используется как замена этому договору. Отдельный typeText в XCTest проверяет настоящий клавиатурный путь, включая несколько последовательных букв.

Caret regression: `testFinalSpeechFollowsEndCaretAndPreservesManualSelection` flushes a final through the microphone Stop action, then uses real XCUI keyboard input for empty/prefixed drafts and intentional interior caret/selection, in both themes.

Full-screen regression: launch with `fullscreen` to put the composer into a bottom safe-area inset under a scrollable conversation, with attachment, agent Stop and speech controls. The CADisplayLink probe measures screen-space prefix/editor/history coordinates, not only coordinates inside the editor. The test waits for twelve stable presentation frames after the one initial expansion and requires actual prefix/history samples, then checks partial/final/finished, retained height and explicit clear in both themes. The bounded test phrase fits within the six-line viewport; normal scrolling beyond that limit is separate from layout stability.
