'use client'

import { ErrorBoundary } from 'react-error-boundary'
import { QueryErrorResetBoundary } from '@tanstack/react-query'

function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown
  resetErrorBoundary: () => void
}) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-medium text-red-500">Something went wrong</h2>
        <pre className="text-sm text-fg-muted bg-bg-secondary p-4 rounded overflow-auto">
          {errorMessage}
        </pre>
        <button
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-accent text-bg rounded hover:opacity-80"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

export function ErrorBoundaryWrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} FallbackComponent={ErrorFallback}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
