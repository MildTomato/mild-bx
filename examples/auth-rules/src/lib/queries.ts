import {
  queryOptions,
  infiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { FolderPage, Folder, File } from './types'
import { supabase } from './supabase'

const PAGE_SIZE = 50
const COUNT_LIMIT = 10_000_001 // 10M + 1 to detect "more than 10M"

/**
 * Format a count for display with good precision:
 * - Exact up to 999
 * - 1.0K, 1.1K, ... 9.9K for thousands (one decimal)
 * - 10K, 11K, ... 99K for tens of thousands
 * - 100K, 110K, ... 999K for hundreds of thousands
 * - 1.0M, 1.1M, ... 9.9M for millions (one decimal)
 * - "10M+" when limit exceeded
 */
export function formatCount(count: number): string {
  if (count >= COUNT_LIMIT) {
    return '10M+'
  }
  if (count < 1_000) {
    return count.toString()
  }
  if (count < 10_000) {
    // 1.0K - 9.9K
    const k = count / 1_000
    return `${k.toFixed(1)}K`
  }
  if (count < 100_000) {
    // 10K - 99K
    const k = Math.round(count / 1_000)
    return `${k}K`
  }
  if (count < 1_000_000) {
    // 100K - 999K
    const k = Math.round(count / 10_000) * 10
    return `${k}K`
  }
  if (count < 10_000_000) {
    // 1.0M - 9.9M
    const m = count / 1_000_000
    return `${m.toFixed(1)}M`
  }
  return '10M+'
}

async function fetchFolderPage(
  folderId: string | null,
  cursor: string | null
): Promise<FolderPage> {
  // Build queries for folders and files
  let foldersQuery = supabase
    .from('folders')
    .select('id, name, parent_id, owner_id')
    .order('name')
    .limit(PAGE_SIZE)

  let filesQuery = supabase
    .from('files')
    .select('id, name, folder_id, content, owner_id, size, created_at')
    .order('name')
    .limit(PAGE_SIZE)

  if (folderId) {
    foldersQuery = foldersQuery.eq('parent_id', folderId)
    filesQuery = filesQuery.eq('folder_id', folderId)
  } else {
    foldersQuery = foldersQuery.is('parent_id', null)
    filesQuery = filesQuery.is('folder_id', null)
  }

  // Apply cursor-based pagination
  if (cursor) {
    foldersQuery = foldersQuery.gt('name', cursor)
    filesQuery = filesQuery.gt('name', cursor)
  }

  // Parallel fetch
  const [foldersRes, filesRes] = await Promise.all([foldersQuery, filesQuery])

  const folders = foldersRes.data ?? []
  const files = filesRes.data ?? []

  // Determine next cursor from the last item
  const allItems = [...folders.map(f => f.name), ...files.map(f => f.name)]
  const lastName = allItems.length > 0 ? allItems[allItems.length - 1] : null
  const hasMore = folders.length === PAGE_SIZE || files.length === PAGE_SIZE

  return {
    folders,
    files,
    nextCursor: hasMore ? lastName : null,
    prevCursor: cursor,
  }
}

async function fetchFolderCount(folderId: string): Promise<number> {
  // Use RPC to get recursive count of all descendants (with limit for performance)
  const { data, error } = await supabase.rpc('get_folder_item_count', {
    p_folder_id: folderId,
    p_limit: COUNT_LIMIT,
  })

  if (error) {
    console.error('Failed to get folder count:', error.message, error.code, error.details, error.hint)
    return 0
  }

  return data ?? 0
}

// Query Options Factories (v5 best practice)
export const folderContentsOptions = (folderId: string | null) =>
  infiniteQueryOptions({
    queryKey: ['folder-contents', folderId] as const,
    queryFn: ({ pageParam }) => fetchFolderPage(folderId, pageParam),
    initialPageParam: null as string | null, // v5 REQUIRED
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    getPreviousPageParam: (firstPage) => firstPage.prevCursor, // Required for maxPages
    maxPages: 10, // CRITICAL: Memory optimization for millions of items
  })

export const folderCountOptions = (folderId: string) =>
  queryOptions({
    queryKey: ['folder-count', folderId] as const,
    queryFn: () => fetchFolderCount(folderId),
    staleTime: 1000 * 60 * 5,
  })

// Custom Hooks
export function useFolderContents(folderId: string | null) {
  return useInfiniteQuery(folderContentsOptions(folderId))
}

export function useFolderCount(folderId: string) {
  return useQuery(folderCountOptions(folderId))
}

// Mutation Hooks
export function useCreateFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['create-folder'],
    mutationFn: async (data: { name: string; parentId: string | null; ownerId: string }) => {
      const { error } = await supabase.from('folders').insert({
        id: crypto.randomUUID(),
        name: data.name,
        parent_id: data.parentId,
        owner_id: data.ownerId,
      })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents', variables.parentId] })
      queryClient.invalidateQueries({ queryKey: ['folder-count'] })
    },
  })
}

export function useDeleteFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['delete-folder'],
    mutationFn: async (folderId: string) => {
      const { error } = await supabase.from('folders').delete().eq('id', folderId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
      queryClient.invalidateQueries({ queryKey: ['folder-count'] })
    },
  })
}

export function useRenameFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['rename-folder'],
    mutationFn: async (data: { id: string; name: string }) => {
      const { error } = await supabase
        .from('folders')
        .update({ name: data.name })
        .eq('id', data.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
    },
  })
}

export function useCreateFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['create-file'],
    mutationFn: async (data: { name: string; folderId: string | null; ownerId: string }) => {
      const rand = Math.random()
      const size =
        rand < 0.7
          ? Math.floor(Math.random() * 1048576) + 1024
          : rand < 0.9
            ? Math.floor(Math.random() * 9437184) + 1048576
            : Math.floor(Math.random() * 94371840) + 10485760
      const { error } = await supabase.from('files').insert({
        id: crypto.randomUUID(),
        name: data.name,
        folder_id: data.folderId,
        owner_id: data.ownerId,
        content: '',
        size,
      })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents', variables.folderId] })
      queryClient.invalidateQueries({ queryKey: ['folder-count'] })
    },
  })
}

export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['delete-file'],
    mutationFn: async (fileId: string) => {
      const { error } = await supabase.from('files').delete().eq('id', fileId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
      queryClient.invalidateQueries({ queryKey: ['folder-count'] })
    },
  })
}

export function useRenameFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['rename-file'],
    mutationFn: async (data: { id: string; name: string }) => {
      const { error } = await supabase
        .from('files')
        .update({ name: data.name })
        .eq('id', data.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
    },
  })
}

export function useUpdateFileContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['update-file-content'],
    mutationFn: async (data: { id: string; content: string }) => {
      const { error } = await supabase
        .from('files')
        .update({ content: data.content })
        .eq('id', data.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
    },
  })
}
