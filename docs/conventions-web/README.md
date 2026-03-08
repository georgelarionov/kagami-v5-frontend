# Conventions

Пошаговые инструкции по расширению kagami-web (frontend + BFF).

## Guides

- [Adding a BFF API Route](./adding-bff-route.md) — серверный endpoint (Next.js API route)
- [Adding a Hook](./adding-hook.md) — react-query хук для серверного состояния
- [Adding a UI Component](./adding-component.md) — компонент в chat или settings

## Project Structure

```
src/
  app/api/          # BFF routes — Clerk auth → Mastra proxy
  components/
    chat/           # Chat UI (message-list, composer, run-status, etc.)
    settings/       # Settings UI (project-settings, tool-params-form)
    ui/             # shadcn components — НЕ редактировать вручную
  hooks/            # react-query хуки (use-*.ts)
  db/               # Drizzle schema + client
  lib/              # Утилиты (mastra client, cn())
  types/            # Shared types
```

## Key Conventions

| Rule | Details |
|---|---|
| `"use client"` | Все интерактивные компоненты. Server components только для layout |
| BFF auth | Каждый API route начинается с `await auth()` → 401 |
| shadcn | `npx shadcn@latest add <component>`, не редактировать `src/components/ui/` |
| Hooks | Файлы `use-<name>.ts` в `src/hooks/`, react-query для серверного состояния |
| Types | Shared типы в `src/types/`, не экспортировать из компонентов |
| Mastra proxy | BFF проксирует к Mastra Server, browser никогда не обращается к Mastra напрямую |
| Agent ID | `kagami-supervisor` — единственный агент с которым общается BFF |
