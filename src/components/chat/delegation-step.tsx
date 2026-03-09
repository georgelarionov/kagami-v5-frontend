'use client'

import {
  Steps,
  StepsTrigger,
  StepsContent,
} from '@/components/ui/steps'
import { MessageContent } from '@/components/ui/message'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { parseReportMarkers } from '@/lib/parse-report-markers'
import { ReportEmbed } from '@/components/chat/report-embed'

interface DelegationStepProps {
  agentName: string
  state: string
  output?: unknown
  errorText?: string
}

function formatOutput(output: unknown): string | null {
  if (output == null) return null
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    // Mastra wraps sub-agent text in { text: "..." }
    const obj = output as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    return JSON.stringify(output, null, 2)
  }
  return String(output)
}

export function DelegationStep({ agentName, state, output, errorText }: DelegationStepProps) {
  const isLoading = state === 'input-streaming' || state === 'input-available'
  const isError = state === 'output-error'
  const isDone = state === 'output-available'

  const icon = isLoading
    ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
    : isError
    ? <AlertCircle className="size-4 text-destructive" />
    : <CheckCircle2 className="size-4 text-green-500" />

  const outputText = isDone ? formatOutput(output) : null

  return (
    <Steps defaultOpen={false}>
      <StepsTrigger leftIcon={icon}>
        {isLoading ? `${agentName}...` : agentName}
      </StepsTrigger>
      {isError && errorText && (
        <StepsContent>
          <p className="text-sm text-destructive">{errorText}</p>
        </StepsContent>
      )}
      {isDone && outputText && (
        <StepsContent>
          <div className="text-sm">
            {parseReportMarkers(outputText).map((segment, i) => {
              if (segment.type === 'report') {
                return (
                  <ReportEmbed
                    key={`delegation-report-${i}`}
                    marker={segment.marker}
                  />
                )
              }
              return (
                <MessageContent key={`delegation-text-${i}`} markdown className="bg-transparent prose-sm dark:prose-invert">
                  {segment.content}
                </MessageContent>
              )
            })}
          </div>
        </StepsContent>
      )}
    </Steps>
  )
}
