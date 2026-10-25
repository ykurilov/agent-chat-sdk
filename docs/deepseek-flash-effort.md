# Уровни DeepSeek 4.1 Flash1017

Стандартный профиль deepseek-4.1-flash предлагает off/low/high/max, default high. Три силы соответствуют low/high/max официального DeepSeek Thinking Mode; off сохраняет отключение. Точные датированные id не меняются: OpenRouter deepseek/deepseek-v4.1-flash-1017, Fireworks accounts/fireworks/models/deepseek-v4p1-flash-1017, Together deepseek-ai/DeepSeek-V4.1-Flash-1017; прямой DeepSeek использует обновляемый alias deepseek-flash.

Сохранённое on, включая defaultChoice, канонизируется в high при проверке выбора только у профиля DeepSeek, который уже заменил on на high. Провайдер остаётся прежним. Raw chat/history не переписываются, миграции БД нет. При следующем явном выборе сохраняется канонический уровень. Собственные профили с прежним on сохраняют прежнее поведение.

На OpenRouter выбранный max отправляется как reasoning.effort=max, а не общий xhigh. На Fireworks и Together max передаётся в provider-specific reasoningEffort: общий SDK xhigh у Fireworks понижается до high. Исключение ограничено точными id Flash1017, другие модели не меняются. Прямой DeepSeek отправляет thinking enabled и reasoning_effort. Off выключает прежним способом.

## Как обновить приложение

Все установленные пакеты SDK обновить одной версией. У стандартного каталога не требуется app-level override. Удалите статически закреплённый providerOptions effort, если ранее он перекрывал выбранный пользователем уровень. Настройки доступа к меню и provider fallback сохраняйте. Новых обязательных env, таблиц, storage/queue API нет. При обновлении с0.82.1 учесть отдельно docs/turn-durability.md: встроенные хранилища готовы, startup recovery и flush сохраняются, обёртки обязаны передавать guard параметры. Новых opt-in функций включать не требуется.

Проверить меню, сохранение low/high/max после reload, старый чат с on, выбранного провайдера и фактический wire при fallback. Проверки SDK перехватывают реальные сериализаторы всех четырёх провайдеров; это проверяет отправленные параметры, не сравнительное качество ответов модели.

## Источники и живые проверки 25.10.2026

DeepSeek: https://api-docs.deepseek.com/guides/thinking_mode/ . OpenRouter schema: https://openrouter.ai/openapi.json . Каталог: https://openrouter.ai/api/v1/models . Для Flash1017 supported_efforts max/high/low/none, default high.

Ограниченные живые max-запросы на direct DeepSeek, точный OpenRouter с only=deepseek и Fireworks завершились stop без ошибки. Прямой Together вернул HTTP403 Cloudflare1010: доступность этого маршрута не подтверждена, статус не выдаётся за успех. Wire-тест Together проверяет сформированное тело без сети. Запросы короткие; равенство семантики и качества рассуждений разных хозяев не заявляется.
