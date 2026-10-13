# Договор скина: версия 10 (016)

Только необязательные добавления. Скины версии 9 продолжают работать: кнопки режима у них нет.

## `Composer.dialog?: VoiceDialogView`

```ts
interface VoiceDialogView {
  state: "off" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error";
  error?: "microphone_denied" | "microphone_missing" | "network" | "service_unavailable"
        | "recognition_lost" | "speech_unavailable" | "limit" | "rate_limited" | "idle" | "backgrounded";
  speechAvailable: boolean;                    // false — слушаем и пишем, но не озвучиваем
  voices?: { id: string; name: string }[];     // нет или один — меню не показывается
  currentVoiceId?: string;
  level?: number;                              // 0..1 громкость микрофона для индикации
  onToggle(): void;                            // включить / выключить (вызывается из нажатия)
  onSelectVoice?(id: string): void;
}
```

Скин рисует кнопку режима рядом с кнопкой диктовки и, пока `state !== "off"`, экран/панель режима: состояние словами, меню голосов, кнопку выхода, надпись ошибки. Поле ввода в режиме скрыто или неактивно (на телефоне не вызывает клавиатуру).

## `AgentMessage.voiceInterrupted?: { spokenTail: string }`

Есть, если озвучка ответа была оборвана перебиванием. Скин показывает отметку «Вы перебили: озвучено до «…»». Перезагрузка страницы сохраняет отметку (данные из хранилища, поле `voiceCut`).

## Словарь надписей (`labels`)

Новый раздел `voiceDialog`: названия состояний, подписи кнопок («Голосовой режим», «Выйти»), меню голосов, отметка обрыва, все `error` выше. Русский и английский.

## Совместимость

`SKIN_CONTRACT_VERSION` 9 → 10, `MAJOR` не нужен: изменения только необязательные. Тандем реализует всё; сверка версии — как в предыдущих версиях (`skin-contract.ts`, тесты договора).
