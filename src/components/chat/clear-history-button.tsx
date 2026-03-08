'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface ClearHistoryButtonProps {
  onClear: () => Promise<void>
  disabled?: boolean
}

export function ClearHistoryButton({ onClear, disabled }: ClearHistoryButtonProps) {
  const [open, setOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const handleClear = async () => {
    setIsClearing(true)
    try {
      await onClear()
      toast.success('Chat history cleared')
      setOpen(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to clear history',
      )
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Clear chat history"
        >
          <Trash2 className="size-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all messages in this chat.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleClear()
            }}
            disabled={isClearing}
            variant="destructive"
          >
            {isClearing ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
