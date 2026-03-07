# Kagami v0.2 — Продуктовое описание

> Фаза 2: Фичи чата. Строится поверх завершённого MVP (v0.1).
> Конфигурация — на уровне проекта. Разработка начинается с бэкенда.

## Текущее состояние (v0.1)

- Один агент (kagamiAgent), без тулов, без стриминга
- Ответы через polling (fire-and-forget workflow)
- Один захардкоженный чат, один захардкоженный проект
- Working memory включена (scope: resource)
- Задеплоено: Railway (бэкенд) + Railway (фронтенд)

### UI стек
- **shadcn/ui** — базовые компоненты (уже есть)
- **prompt-kit** (prompt-kit.com) — AI-специфичные компоненты поверх shadcn. Установка: `npx shadcn@latest add "https://prompt-kit.com/c/[COMPONENT].json"`
  - `Message` + `Markdown` — рендеринг сообщений с markdown
  - `Tool` — отображение tool calls (состояния: input-streaming, output-available, output-error — совпадает с AI SDK)
  - `Prompt Input` — textarea + кнопки действий
  - `Code Block` — подсветка синтаксиса (shiki)
  - `Loader` / `Thinking Bar` — индикаторы генерации
  - `Steps` — пошаговый прогресс (для делегирования агентов)
  - `Reasoning` / `Chain of Thought` — для thinking (позже)
  - `Chat Container`, `Scroll Button` — layout

---

## F1. Стриминг

Замена polling на real-time стриминг. Пользователь видит ответ по мере генерации.

### Поведение (ChatGPT-паттерн)
- Пользователь отправляет сообщение → токены стримятся в реальном времени
- Если пользователь закрыл вкладку — генерация **продолжается на сервере**
- При возврате: фронт загружает ответ из memory (мгновенно, если генерация завершена)
- Если ответа в memory нет (генерация прервалась) — показать pendingMessage + retry

### Критический эксперимент (первый шаг реализации)
Проверить: продолжает ли Mastra Server генерацию если BFF отключился от стрима.
- Если ДА → используем `agent.stream()` напрямую (стрим + автосохранение в memory)
- Если НЕТ → нужна обёртка (workflow fire-and-forget или серверный процесс, который держит стрим)

### Бэкенд
- Заменить workflow + `agent.generate()` на прямой `agent.stream()` с memory
- BFF проксирует стрим от Mastra Server к клиенту через AI SDK v6 (stable)
- Memory автоматически сохраняет сообщения по завершении стрима
- Сохранять `pendingMessage` в БД до начала стрима (как сейчас) — fallback при обрыве
- Workflow остаётся в репо для будущей фазы отчётов, но для чата не используется

### Фронтенд
- Заменить polling (`use-chat-run`) на `useChat` из AI SDK v6 (stable)
- Удалить `active-run`, `runs/[id]` polling-эндпоинты
- Прогрессивный рендеринг текста (по токенам)
- При перезагрузке: загрузить messages из memory → если ответа нет → показать pending + retry
- При обрыве стрима: не паниковать, загрузить из memory при следующем визите

### Используемые возможности Mastra + AI SDK

**Подход B — Next.js BFF route (auth + ownership в BFF):**
- BFF контролирует: Clerk auth → ownership check → project config → вызов Mastra
- BFF вызывает `MastraClient.getAgent().stream()` (HTTP к Mastra Server)
- Конвертация: `toAISdkStream()` из `@mastra/ai-sdk` → `createUIMessageStreamResponse()` из `ai`
- Примечание: `handleChatStream()` требует embedded Mastra instance — не подходит для двух-реповой архитектуры

**Клиент:**
- `useChat` из `@ai-sdk/react` с `DefaultChatTransport` (transport-based)
- `sendMessage({ text })` для отправки, `message.parts` для рендеринга
- `toAISdkV5Messages()` из `@mastra/ai-sdk/ui` — конвертация Mastra messages для `initialMessages`
- Типы частей сообщений: `text`, `tool-{toolKey}` (с состояниями input-available/output-available/output-error)
- Пакеты: `ai@6.0.x` (stable), `@ai-sdk/react@3.0.x`, `@mastra/ai-sdk@1.1.x`

---

## F2. Персистентность сообщений и пагинация

Сервер — источник истины. Фронтенд только отображает и отправляет пользовательский ввод.

### Бэкенд
- Сообщения хранятся в Mastra memory (уже реализовано)
- API для выборки сообщений (всегда загружать последнюю доступную пачку)
- API для удаления истории чата (очистка сообщений треда)

### Фронтенд
- Загружать последнюю пачку сообщений при открытии чата
- Пагинация на клиенте (MVP — observational memory сжимает старые сообщения, длинных историй не будет)
- Восстановление чата при перезагрузке: загрузить последнюю пачку, отрендерить сразу
- Кнопка удаления истории чата (вызов API бэкенда)

### Используемые возможности Mastra
- `thread.listMessages()` с параметрами пагинации
- `memory.deleteMessages()` для очистки истории

---

## F3. Отображение тулов

Показ использования тулов агентом в виде сворачиваемых блоков в UI чата.

### Бэкенд
- Изменений не требуется — вызовы тулов/результаты уже включены в чанки стрима и историю сообщений

### Фронтенд
- Парсинг чанков `tool-call` и `tool-result` из стрима
- Рендер сворачиваемых блоков: имя тула + статус (loading/success/error) + превью результата
- В истории сообщений: парсинг сохранённых tool call/result из формата сообщений Mastra
- Одинаковый рендеринг для стриминга и режима истории

---

## F4. Supervisor Agent

Замена одного агента на supervisor, который делегирует задачи специализированным суб-агентам.

### Бэкенд
- Создать supervisor-агента с `agents` property, содержащим суб-агентов
- Каждый суб-агент имеет: id, description, instructions, model, tools
- Supervisor использует `agent.stream()` (рекомендуется вместо `.network()`)
- Общая память: все агенты используют один экземпляр Memory (scope: resource, working memory включена)
- Observational memory включена для компрессии длинных разговоров
- Хуки делегирования для мониторинга (`onDelegationStart`, `onDelegationComplete`)

### Фронтенд
- Отображение событий делегирования: "Передано [Имя агента]..." как инлайн-статус
- Ответы суб-агентов рендерятся так же, как текст supervisor'а (минимальный UI)
- Отдельного UI для каждого суб-агента нет (в рамках v0.2)

### Используемые возможности Mastra
- Supervisor паттерн: `new Agent({ agents: { subAgent1, subAgent2 } })`
- `agent.stream()` с колбэками делегирования
- `Memory` с `workingMemory: { enabled: true, scope: 'resource' }` + `observationalMemory: true`

---

## F5. Тулы и MCP-интеграция

Агенты используют тулы Mastra и тулы MCP-серверов.

### Бэкенд
- Определение тулов через `createTool()` с inputSchema/outputSchema/execute
- Подключение MCP-серверов через `MCPClient` (захардкожены в коде бэкенда)
- Назначение тулов агентам: `new Agent({ tools: { tool1, tool2, ...mcpTools } })`
- Тулы доступны суб-агентам, не только supervisor'у

### Фронтенд
- UI конфигурации MCP нет (захардкожено в бэкенде)
- Активность тулов видна через F3 (сворачиваемые блоки)

### Используемые возможности Mastra
- `createTool()` для кастомных тулов
- `MCPClient` для интеграции внешних MCP-серверов
- Свойство `tools` агента (статическое или через `requestContext`)

---

## F6. Конфигурация на уровне проекта через Request Context

Конфигурация per-project: системные промпты, выбор тулов, параметры тулов. Хранится в БД, применяется через Mastra `requestContext`.

### Архитектура: B2 (project_id в header → Mastra middleware → DB lookup)
- BFF передаёт `X-Project-Id` в заголовке при каждом вызове MastraClient
- Mastra Server middleware читает header, загружает конфиг из БД через `store.db.oneOrNone()`
- Middleware заполняет `requestContext` данными конфига
- Агенты используют динамические функции: `instructions: ({ requestContext }) => ...`
- Тулы резолвятся динамически: `tools: ({ requestContext }) => ...`

### Shared DB, split schema ownership
- Одна Neon БД для обоих сервисов
- Фронтенд владеет таблицами `projects`, `chats`, `project_config` (Drizzle миграции)
- Бэкенд владеет таблицами `mastra_*` (авто-создание PostgresStore)
- Бэкенд **читает** фронтовые таблицы через `store.db`, но **не мигрирует** их

### База данных
- Таблица `project_config` (миграция через Drizzle на фронтенде):
  - `project_id`: uuid (FK → projects.id, unique, not null)
  - `supervisor_prompt`: text (nullable, перезаписывает дефолт)
  - `agent_prompts`: jsonb — `{ [agentId]: string }` (nullable per agent, перезаписывает дефолты)
  - `active_tools`: jsonb — `string[]` (какие тулы включены)
  - `tool_params`: jsonb — `{ [toolId]: { [param]: value } }` (конфиг конкретных тулов)
- Дефолты захардкожены в определениях агентов/тулов. В БД хранятся только переопределения.

### Фронтенд
- Страница (или панель) настроек проекта:
  - Редактирование системного промпта supervisor'а (textarea, кнопка "Сбросить к дефолту")
  - Редактирование промптов суб-агентов (textarea для каждого)
  - Переключение тулов вкл/выкл (список чекбоксов)
  - Настройка параметров тулов (динамическая форма на основе configSchema тула)
- Настройки сохраняются в БД через API
- Изменения применяются к следующему сообщению (перезапуск не нужен)

### Используемые возможности Mastra
- `requestContext` в `agent.stream()` / `agent.generate()`
- Динамические `instructions`, `tools`, `model` через `({ requestContext }) => ...`
- `requestContextSchema` для валидации

---

## F7. Стандарт добавления агентов, тулов, MCP

Документация и конвенции для расширения системы.

### Конвенция: добавление нового тула
1. Создать файл `src/mastra/tools/<tool-id>.ts`
2. Экспортировать через `createTool()` с id, description, inputSchema, outputSchema, execute
3. Опционально: добавить `configSchema` (zod) для UI-настраиваемых параметров
4. Зарегистрировать в `tools` map агента
5. Добавить в `TOOL_REGISTRY` (метаданные для фронтенда: id, name, description, configSchema)

### Конвенция: добавление нового суб-агента
1. Создать файл `src/mastra/agents/<agent-id>.ts`
2. Экспортировать Agent с id, description, instructions (дефолт), model, tools
3. Зарегистрировать в `agents` map supervisor'а
4. Добавить в `AGENT_REGISTRY` (метаданные для фронтенда: id, name, description, defaultPrompt)

### Конвенция: добавление MCP-сервера
1. Добавить конфиг MCPClient в `src/mastra/mcp/<server-id>.ts`
2. Spread MCP-тулы в tools map нужного агента
3. Добавить в `TOOL_REGISTRY` с source: 'mcp'

### Интеграция с фронтендом
- Эндпоинт `/api/registry` возвращает AGENT_REGISTRY + TOOL_REGISTRY
- UI настроек проекта автогенерирует формы из метаданных реестра
- При добавлении новых агентов/тулов в бэкенд изменения фронтенда не нужны

---

## F8. Управление историей чата

### Бэкенд
- API: удалить все сообщения треда

### Фронтенд
- Кнопка "Очистить историю" в UI чата
- Диалог подтверждения перед удалением
- Перезагрузка сообщений после очистки

---

## За рамками v0.2

- Workspace / sandbox (отложено до фазы отчётов)
- Генерация отчётов (следующая фаза)
- Multi-project / multi-chat UI (фаза инфраструктуры)
- Настройка MCP-серверов пользователем через UI
- Конфиг per-chat (конфиг только на уровне проекта)
- Отображение thinking/reasoning (скрыто в минимальном UI)
- Включение/выключение суб-агентов из UI
- Авторизация / регистрация (захардкоженный пользователь)

---

## Порядок реализации

Последовательность оптимизирована для минимума переделок и изоляции багов:

```
F1 (Стриминг) — фундамент, меняет транспортный слой
    |
F2 (Пагинация и персистентность) — стабилизирует работу с сообщениями
    |
F3 (Отображение тулов) — UI для чанков тулов (зависит от формата стрима F1)
    |
F4 (Supervisor agent) — мульти-агент (зависит от работающего стриминга F1)
    |
F5 (Тулы и MCP) — даём агентам возможности (зависит от структуры агентов F4)
    |
F6 (Конфиг через request context) — UI конфигурации per-project (зависит от стабильных F4+F5)
    |
F7 (Стандарт реестра) — документирование конвенций (зависит от проверенных паттернов F5+F6)
    |
F8 (Управление историей) — низкий риск, можно делать в любой момент после F2
```

### Порядок внутри фичи: сначала бэкенд, потом фронтенд

Каждая фича: реализация бэкенда -> проверка через Mastra Studio / curl -> реализация фронтенда.

---

## Технические решения

### Принятые
1. **Транспорт стриминга:** Прямой `agent.stream()` с memory (ChatGPT-паттерн). Workflow остаётся для будущих отчётов. Первый шаг — эксперимент с поведением Mastra Server при дисконнекте.
2. **Интеграция AI SDK:** AI SDK v6 stable (`ai@6.0.x`) — `@ai-sdk/react` + `useChat` с `DefaultChatTransport`, `toAISdkStream()` из `@mastra/ai-sdk`
3. **Хранение конфига:** Таблица `project_config` (Drizzle миграция на фронтенде). Бэкенд читает через `store.db` в middleware. Подход B2: `X-Project-Id` в header → middleware → DB lookup → requestContext.

### Открытые
1. **Формат реестра:** Кастомный endpoint на Mastra Server через `registerApiRoute()` — возвращает полный registry (агенты + тулы + configSchema). `listAgents()`/`listTools()` из MastraClient не содержат кастомные метаданные.
2. **Модель observational memory:** Дефолтная `google/gemini-2.5-flash` или та же модель, что у агента?
3. **Стриминг через chatRoute() vs ручная конвертация:** Альтернатива текущему плану — добавить `chatRoute()` на Mastra Server (отдаёт AI SDK формат напрямую), BFF только auth + proxy без конвертации. Проще и надёжнее. Проверить при реализации F1.
4. **Delegation events через MastraClient:** Проходят ли события делегирования supervisor'а через `MastraClient.stream()` и `chatRoute()`? Если нет — отображение "Передано [Agent]..." невозможно без workaround. Проверить при реализации F4.

---

## Координация двух репо

- **Shared DB, split ownership:** фронт мигрирует свои таблицы (Drizzle), бэкенд свои (PostgresStore auto). Бэкенд только читает фронтовые таблицы.
- **Порядок деплоя:** фронт первый (миграция БД), бэкенд второй (читает новые таблицы). Для F1: бэкенд первый (новый streaming endpoint), фронт второй (переключение), старые polling endpoints не удалять до полного перехода.
- **Правило:** не удалять старые endpoints/API пока оба сервиса не переехали на новую версию.
