'use client'

import { useMutationState } from '@tanstack/react-query'

export function GlobalMutationIndicator() {
  const pendingMutations = useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.variables,
  })

  if (pendingMutations.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 bg-accent text-bg px-3 py-1 rounded z-50">
      Saving...
    </div>
  )
}
