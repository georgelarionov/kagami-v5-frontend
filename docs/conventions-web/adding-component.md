# Adding a UI Component

## Directories

| Directory | Purpose | Edit? |
|---|---|---|
| `src/components/ui/` | shadcn primitives | НЕТ — `npx shadcn@latest add <name>` |
| `src/components/chat/` | Chat UI (message list, composer, buttons) | ДА |
| `src/components/settings/` | Settings UI (project settings, forms) | ДА |

## Steps

### 1. Выбрать директорию

- Chat-related → `src/components/chat/`
- Settings-related → `src/components/settings/`
- Новая domain area → создать `src/components/<area>/`

### 2. Create component

```tsx
'use client'

import { Button } from '@/components/ui/button'
// другие shadcn imports...

interface MyComponentProps {
  // typed props
}

export function MyComponent({ ...props }: MyComponentProps) {
  return (
    // JSX
  )
}
```

### 3. Patterns

**shadcn primitives:**

```bash
# Добавить новый shadcn компонент
npx shadcn@latest add alert-dialog
```

Список установленных: `ls src/components/ui/`

**Toast notifications** (sonner):

```tsx
import { toast } from 'sonner'

toast.success('Done')
toast.error('Failed')
toast.error(error instanceof Error ? error.message : 'Unknown error')
```

**Loading state:**

```tsx
import { Loader2 } from 'lucide-react'

{isLoading ? (
  <Loader2 className="size-4 animate-spin" />
) : null}
```

**Icons** — `lucide-react`, `size-*` для размера:

```tsx
import { Settings, Trash2, RotateCcw, AlertCircle } from 'lucide-react'

<Settings className="size-5" />
```

### 4. Integration в chat-page

Основной layout — `src/components/chat/chat-page.tsx`:

```
┌─────────────────────────────┐
│ Header: title + buttons     │  ← ClearHistoryButton, ProjectSettings
├─────────────────────────────┤
│ MessageList                 │  ← scrollable, auto-scroll
│                             │
├─────────────────────────────┤
│ RunStatus                   │  ← streaming indicator / errors
│ Composer                    │  ← input + send/stop
└─────────────────────────────┘
```

Новые header buttons: добавить в `<div className="flex items-center gap-1">` рядом с существующими.

### 5. Delegation / Tool display

Порядок проверок в `message-list.tsx`:

1. `isDelegationPart()` → `DelegationStep` — проверяет `part.type.startsWith('tool-agent-')`
2. `isToolPart()` → `Tool` component
3. Default → `MessageContent` (text)

**Не использовать `agent-` prefix в backend tool keys** — tool key `agent-foo` создаёт `part.type === 'tool-agent-foo'` в стриме, что ложно срабатывает как delegation.

## Checklist

- [ ] `'use client'` directive
- [ ] Props typed с интерфейсом
- [ ] shadcn компоненты из `@/components/ui/` (не кастомные)
- [ ] Lucide icons для иконок
- [ ] Sonner toast для feedback
- [ ] Loading/error states обработаны
- [ ] `disabled` при streaming (`status !== 'ready'`)
