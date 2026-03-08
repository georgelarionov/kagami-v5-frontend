'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface ToolParamsFormProps {
  toolId: string
  schema: Record<string, unknown>
  values: Record<string, unknown>
  onChange: (param: string, value: unknown) => void
}

export function ToolParamsForm({ toolId, schema, values, onChange }: ToolParamsFormProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties = (schema as any).properties as Record<string, any> | undefined
  if (!properties) return null

  return (
    <div className="ml-7 mt-2 space-y-2 rounded-md border p-3">
      {Object.entries(properties).map(([key, prop]) => {
        const label = prop.description || key
        const defaultValue = prop.default

        if (prop.type === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`${toolId}-${key}`}
                checked={(values[key] as boolean) ?? defaultValue ?? false}
                onCheckedChange={(checked) => onChange(key, !!checked)}
              />
              <Label htmlFor={`${toolId}-${key}`} className="text-xs cursor-pointer">
                {label}
              </Label>
            </div>
          )
        }

        if (prop.type === 'number' || prop.type === 'integer') {
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${toolId}-${key}`} className="text-xs">
                {label}
              </Label>
              <Input
                id={`${toolId}-${key}`}
                type="number"
                value={(values[key] as number) ?? defaultValue ?? ''}
                onChange={(e) =>
                  onChange(key, e.target.value ? Number(e.target.value) : undefined)
                }
                min={prop.minimum}
                max={prop.maximum}
                className="h-8 text-xs"
              />
            </div>
          )
        }

        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={`${toolId}-${key}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`${toolId}-${key}`}
              type="text"
              value={(values[key] as string) ?? defaultValue ?? ''}
              onChange={(e) => onChange(key, e.target.value || undefined)}
              className="h-8 text-xs"
            />
          </div>
        )
      })}
    </div>
  )
}
