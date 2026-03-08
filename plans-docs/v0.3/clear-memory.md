# Clear Memory — идея

> v0.3 backlog

## Проблема

При очистке истории чата (F8) удаляются только сообщения. Working memory агента (контекст между сообщениями) сохраняется. Пользователь ожидает "чистый лист", но агент помнит предыдущий контекст.

## Идея

Тогл в диалоге очистки:

- **Clear messages only** — удалить историю, сохранить память агента (текущее поведение F8)
- **Clear messages and memory** — удалить историю + сбросить working memory агента

## UI

В AlertDialog добавить чекбокс или switch:

```
☑ Also clear agent memory
```

По умолчанию выключен — безопасный вариант.

## Известные баги

### DELETE /memory/deleteMessages → 404

```
[chat/messages] Failed to delete messages: Error: deleteMessages failed: 404
DELETE /api/chat/messages?chatId=... 500
```

BFF вызывает `DELETE {MASTRA_API_URL}/memory/deleteMessages` с `{ threadId, clearAll: true }` — Mastra возвращает 404. Возможные причины:

- Endpoint не `/memory/deleteMessages`, а другой путь (проверить актуальную версию Mastra)
- `clearAll` не поддерживается в текущей версии `@mastra/core`
- Нужно использовать `client-js` `thread.deleteMessages()` вместо прямого REST

Разобраться при реализации v0.3.

## Открытые вопросы

1. Какой Mastra API для очистки working memory? Проверить: `thread.delete()` удаляет и memory? Или отдельный endpoint?
2. Нужно ли пересоздавать thread после удаления? (`threadId = chatId` маппинг)
3. UX: объяснить пользователю разницу между "историей" и "памятью" — tooltip или описание в диалоге
4. Актуальный endpoint для удаления сообщений — проверить через `mastra` MCP или исходники `@mastra/core`
