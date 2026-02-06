'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'

const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then(m => m.ReactQueryDevtools),
  { ssr: false }
)

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,     // 5 min
        gcTime: 1000 * 60 * 60,        // 1 hour (v5: renamed from cacheTime)
        refetchOnWindowFocus: false,
        retry: 1,
        throwOnError: true,            // Errors go to error boundary
      },
      mutations: {
        throwOnError: false,
      },
    },
  }))

  const previousUserIdRef = useRef<string | null>(null)

  // Clear cache when user changes (login/logout)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUserId = session?.user?.id ?? null

      // If user changed (not just token refresh), clear the cache
      if (previousUserIdRef.current !== currentUserId) {
        queryClient.clear()
        previousUserIdRef.current = currentUserId
      }
    })

    // Initialize with current user
    supabase.auth.getUser().then(({ data }) => {
      previousUserIdRef.current = data.user?.id ?? null
    })

    return () => subscription.unsubscribe()
  }, [queryClient])

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
