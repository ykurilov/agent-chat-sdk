# Картинка в результате инструмента у хозяев моделей внутри OpenRouter

Замер 2026-10-06. Внутри OpenRouter одну модель обслуживают десятки хозяев (поставщиков). Вопрос: видит ли модель
картинку, которую инструмент вернул в своём результате, у каждого из них.

**Как мерили.** Картинка 256×128: левая половина жёлтая, правая фиолетовая. Она идёт в результате инструмента
`show_picture` тем же путём, что в настоящем ходе агента: провайдер OpenRouter из каталога SDK, сообщение `tool`
с частями `text` и `image_url`. Вопрос: «какие цвета и где». Каждому хозяину — отдельный запрос с
`provider.only=[тег]` и `allow_fallbacks: false`, по 2 раза; кто отказал из-за перегрузки (`rate-limited`) —
ещё раз по одному. Список хозяев — `GET /api/v1/models/{id}/endpoints`.

Повторить: `OPENROUTER_HOSTS_PROBE=1 OPENROUTER_HOSTS_PROBE_OUT=/tmp/probe pnpm vitest run --project live
packages/core/tests/live/openrouter-tool-image-hosts.live.test.ts` (ключ — `OPENROUTER_API_KEY` в окружении;
`OPENROUTER_HOSTS_PROBE_TAGS` — только часть хозяев, `OPENROUTER_HOSTS_PROBE_REASONING` — свой уровень рассуждений).

- «видит» — назвал жёлтый и фиолетовый;
- «ошибся» — ответил, что картинки нет, или назвал не те цвета (сплошной белый, бирюзовый, выдуманные фигуры);
- «ошибка» — хозяин отверг запрос с картинкой.

## Итог

| Модель | Запрещено в профиле (`providerOptions.openrouter.provider.ignore`) | Почему |
|---|---|---|
| DeepSeek 4.1 Flash | `deepinfra`, `open-inference`, `phala`, `sail-research`, `venice` | OpenInference и Phala картинки не видят, Venice видит белое поле; DeepInfra и Sail Research отвергают запрос |
| GLM 5.3 Flash | `cloudflare`, `deepinfra`, `open-inference`, `sail-research`, `venice` | Cloudflare выдумывает фигуры, Venice и OpenInference не видят; DeepInfra и Sail Research отвергают запрос |
| Gemini 3.8 Flash | `google-vertex` | Vertex отвергает запрос («Requests ending with a model turn are not supported»), а в настоящем ходе агента отдаёт пустой ответ |
| GPT 6 Luna | — | Не мерили по хозяевам: на этой картинке видит «сплошной фиолетовый» у всех хозяев и даже в обычном сообщении, то есть дело в модели, а не в хозяине. Однотонные картинки видит (прежний замер) |

Запрещается по имени хозяина целиком (`deepinfra` закрывает `deepinfra/fp8` и `deepinfra/fp4`): OpenRouter так
понимает `ignore`, проверено запросом «только `X`, но `X` запрещён» — «All providers have been ignored».

**Запрет стоит в каждом запросе, а не только когда в истории есть картинка.** Картинка, однажды попав в историю, едет
во всех следующих запросах чата, а включённый с середины чата запрет сменил бы хозяина и сбросил кэш. Постоянный запрет
делает запрос одинаковым в каждом ходе: кэш и закреплённый за чатом хозяин (`x-session-id`) сохраняются. Цена —
на 1–5 хозяев меньше для обычных текстовых запросов; у каждой модели остаётся больше двух десятков (у Gemini — три
варианта Google AI Studio).

Запрет сливается с настройками приложения (`createOpenRouterProvider({ maxPrice, sort, ignore })`): потолок цены и
сортировка остаются, списки `ignore` объединяются.

**Размер картинки.** Однотонную картинку 64×64 в результате инструмента GLM 5.3 Flash почти не различает: зелёный назвала
верно 3 раза из 12 (в обычном сообщении у того же хозяина — 3 из 3). Та же картинка 256×256 — 12 из 12. Настоящие снимки
экрана больше, поэтому отметка у GLM стоит. Но живые проверки `tool-result-images.live.test.ts` и
`screenshot-openrouter.live.test.ts` шлют 64×64 и на GLM падают. Поднять до 256×256 нельзя: тогда путается GPT 6 Luna
(однотонное 256×256 называет чёрным, серым, белым). Нужна картинка, похожая на снимок, — отдельная задача.

Не проверены из-за перегрузки (повторы тоже получили `rate-limited`): у DeepSeek — `fireworks` (его `fireworks/us` видит),
у GLM — `streamlake/fp8`, `baseten/fp8`, `fireworks` (его `fireworks/us` видит). Они не запрещены.

## DeepSeek 4.1 Flash (`deepseek/deepseek-v4.1-flash`)

| Хозяин (тег OpenRouter) | Итог | Ответы | Пример ошибки |
|---|---|---|---|
| `relace` | **видит** | видит 2 |  |
| `open-inference/fp4` | **ошибся** → запрещён | ошибся 2 |  I called `show_picture`, but it didn't return any actual image — the output was just the text "The picture:"  |
| `inference-net` | **видит** | видит 2 |  |
| `wafer` | **видит** | видит 2 |  |
| `sail-research/fp4` | **ошибка** → запрещён | ошибка 2 | [Sail Research] model 'deepseek-ai/DeepSeek-V4.1-Flash' does not support image input {"error":{"message":"Prov |
| `decart/fp4` | **видит** | видит 2 |  |
| `morph/fp8` | **видит** | видит 2 |  |
| `dekallm` | **видит** | видит 2 |  |
| `ionstream` | **видит** | видит 2 |  |
| `deepinfra/fp8` | **ошибка** → запрещён | ошибка 2 | [DeepInfra] Input should be a valid string {"error":{"message":"Provider returned error","code":422,"metadata" |
| `streamlake/fp8` | **видит** | видит 2 |  |
| `atlas-cloud/fp8` | **видит** | видит 2 |  |
| `digitalocean` | **видит** | видит 2 |  |
| `gmicloud/fp8` | **видит** | видит 2 |  |
| `coreweave/fp8` | **видит** | видит 2 |  |
| `nextbit/fp8` | **видит** | видит 2 |  |
| `phala` | **ошибся** → запрещён | ошибся 2 | I called `show_picture`, and here's what I can see in it:  **Overall structure:** The image is a full-frame pa |
| `novita/fp8` | **видит** | видит 2 |  |
| `makora/fp8` | **видит** | видит 2 |  |
| `baidu/fp8` | **видит** | видит 2 |  |
| `baseten/fp8` | **видит** | видит 4, ошибка 4 |  |
| `alibaba` | **видит** | видит 2 |  |
| `together` | **видит** | видит 2 |  |
| `siliconflow/fp8` | **видит** | видит 2 |  |
| `modal` | **видит** | видит 2 |  |
| `parasail/fp8` | **видит** | видит 2 |  |
| `fireworks` | не проверен (перегружен) | ошибка 4 | Тот же Fireworks в варианте `fireworks/us` видит. |
| `venice/fp8` | **ошибся** → запрещён | ошибся 2 | I called `show_picture`. Here's what I can actually make out:  **Overall:** A small, very low-contrast image ( |
| `deepseek` | **видит** | ошибка 2, видит 2 | Ошибки — следствие замера: в нём нет рассуждений прошлого шага. Без рассуждений видит 2 из 2; в настоящем ходе SDK рассуждения возвращает. |
| `fireworks/us` | **видит** | видит 2 |  |

## GLM 5.3 Flash (`z-ai/glm-5.3-flash`)

| Хозяин (тег OpenRouter) | Итог | Ответы | Пример ошибки |
|---|---|---|---|
| `relace` | **видит** | видит 2 |  |
| `open-inference/fp4` | **ошибся** → запрещён | ошибка 1, ошибся 3 | I called `show_picture`, but it returned an empty result — no image was actually displayed to me, so I can't d |
| `sail-research/us` | **ошибка** → запрещён | ошибка 2 | [Sail Research] The request was rejected. Possible causes: input exceeds the model's maximum context length, o |
| `sail-research/fp4` | **ошибка** → запрещён | ошибка 2 | [Sail Research] The request was rejected. Possible causes: input exceeds the model's maximum context length, o |
| `wafer` | **видит** | видит 2 |  |
| `deepinfra/fp4` | **ошибка** → запрещён | ошибка 2 | [DeepInfra] Input should be a valid string {"error":{"message":"Provider returned error","code":422,"metadata" |
| `novita/fp8` | **видит** | видит 2 |  |
| `decart/fp4` | **видит** | ошибка 3, видит 1 |  |
| `streamlake/fp8` | не проверен (перегружен) | ошибка 7 |  |
| `gmicloud/fp8` | **видит** | видит 2 |  |
| `dekallm` | **видит** | видит 2, ошибка 2 |  |
| `near-ai/fp8` | **видит** | ошибка 6, видит 1 |  |
| `phala/fp8` | **видит** | видит 2, ошибка 2 |  |
| `modal/nvfp4` | **видит** | видит 3, ошибка 1 |  |
| `baseten/fp8` | не проверен (перегружен) | ошибка 14 |  |
| `crusoe/fp4` | **видит** | ошибка 2, видит 2 |  |
| `coreweave/nvfp4` | **видит** | видит 2 |  |
| `inference-net/fp4` | **видит** | видит 2 |  |
| `atlas-cloud/fp8` | **видит** | видит 2 |  |
| `fireworks` | не проверен (перегружен) | ошибка 7 |  |
| `friendli` | **видит** | видит 2 |  |
| `siliconflow/fp8` | **видит** | видит 2 |  |
| `digitalocean` | **видит** | ошибка 3, видит 1 |  |
| `together` | **видит** | видит 2 |  |
| `parasail/fp4` | **видит** | видит 2 |  |
| `venice` | **ошибся** → запрещён | ошибка 4, ошибся 3 | I've loaded the image. Let me take a closer look. |
| `z-ai/fp8` | **видит** | видит 2 |  |
| `nextbit/fp8` | **видит** | ошибка 2, видит 2 |  |
| `morph/fp8` | **видит** | видит 2 |  |
| `inceptron/fp8` | **видит** | видит 2 |  |
| `fireworks/us` | **видит** | видит 2 |  |
| `cloudflare` | **ошибся** → запрещён | ошибка 3, ошибся 4 | I called `show_picture` and received a tiny (2×2 pixel) image. Here's what I see:  - **Top-left:** a very dark |
| `reka` | **видит** | видит 2 |  |

## Gemini 3.8 Flash (`google/gemini-3.8-flash`)

| Хозяин (тег OpenRouter) | Итог | Ответы | Пример ошибки |
|---|---|---|---|
| `google-ai-studio/flex` | **видит** | видит 2 |  |
| `google-vertex/global/flex` | **ошибка** → запрещён | ошибка 2 | [Google] Requests ending with a model turn are not supported. {"error":{"message":"Provider returned error","c |
| `google-ai-studio` | **видит** | видит 2 |  |
| `google-vertex/global` | **ошибка** → запрещён | ошибка 2 | [Google] Requests ending with a model turn are not supported. {"error":{"message":"Provider returned error","c |
| `google-ai-studio/priority` | **видит** | видит 2 |  |
| `google-vertex/global/priority` | **ошибка** → запрещён | ошибка 2 | [Google] Requests ending with a model turn are not supported. {"error":{"message":"Provider returned error","c |
