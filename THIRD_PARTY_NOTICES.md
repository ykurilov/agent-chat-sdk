# Сторонний код

Часть кода Agent Chat SDK перенесена из проекта pi-mono (https://github.com/badlogic/pi-mono) по лицензии MIT.

## Что перенесено

| Откуда в pi-mono | Куда в SDK |
|---|---|
| `packages/ai/src/utils/overflow.ts` — признаки переполнения окна модели | `packages/core/src/provider-errors/error-signs.ts` |
| `packages/ai/src/utils/retry.ts` — признаки ошибок, которые не повторяют и которые повторяют | `packages/core/src/provider-errors/error-signs.ts` |
| `packages/ai/src/utils/json-parse.ts` — `repairJson` | `packages/core/src/agent-run/json-repair.ts` |
| `packages/coding-agent/src/utils/image-resize-core.ts` — порядок ужатия картинки для модели | `packages/attachments/src/fit-image.ts` |

## Лицензия pi-mono

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Сторонние библиотеки в зависимостях

Код этих библиотек не перенесён в SDK: пакеты ставятся из npm вместе со своей лицензией.

| Библиотека | Лицензия | Где нужна |
|---|---|---|
| `@xyflow/react` (https://github.com/xyflow/xyflow) | MIT, Copyright (c) 2019-2025 webkid GmbH | доска редактора сценария, вход `@ykurilov/agent-chat-flows/react` |
