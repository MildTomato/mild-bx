import { useState, useEffect } from 'react'
import {
  queryOptions,
  infiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { FolderPage, Folder, File, Share, SharePermission, ShareableUser, Comment, LinkShare } from './types'
import { supabase } from './supabase'

const PAGE_SIZE = 50
const COUNT_LIMIT = 5_001 // 5k + 1 to detect "more than 5k"

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
    return '5k+'
  }
  if (count < 1_000) {
    return count.toString()
  }
  // 1.0k - 5.0k
  const k = count / 1_000
  return `${k.toFixed(1)}k`
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

// Sequential folder counts - fetches one at a time to avoid overwhelming the database
export function useSequentialFolderCounts(folderIds: string[]) {
  const queryClient = useQueryClient()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchSequentially() {
      for (const folderId of folderIds) {
        if (cancelled) break

        // Skip if already cached
        const cached = queryClient.getQueryData<number>(['folder-count', folderId])
        if (cached !== undefined) {
          setCounts(prev => ({ ...prev, [folderId]: cached }))
          continue
        }

        setPendingId(folderId)
        try {
          const count = await queryClient.fetchQuery(folderCountOptions(folderId))
          if (!cancelled) {
            setCounts(prev => ({ ...prev, [folderId]: count }))
          }
        } catch {
          // On error, set to 0
          if (!cancelled) {
            setCounts(prev => ({ ...prev, [folderId]: 0 }))
          }
        }
      }
      if (!cancelled) {
        setPendingId(null)
      }
    }

    fetchSequentially()
    return () => { cancelled = true }
  }, [folderIds.join(','), queryClient])

  return { counts, pendingId }
}

export function useFolder(folderId: string | null) {
  return useQuery({
    queryKey: ['folder', folderId] as const,
    queryFn: async (): Promise<Folder | null> => {
      if (!folderId) return null
      const { data, error } = await supabase
        .from('folders')
        .select('id, name, parent_id, owner_id')
        .eq('id', folderId)
        .single()
      if (error) return null
      return data
    },
    enabled: !!folderId,
  })
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
      const { data: updated, error } = await supabase
        .from('files')
        .update({ name: data.name })
        .eq('id', data.id)
        .select('id')
      if (error) throw error
      if (!updated || updated.length === 0) {
        throw new Error('Permission denied: cannot rename this file')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
    },
  })
}

export function useMoveFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['move-file'],
    mutationFn: async (data: { fileId: string; destinationFolderId: string | null }) => {
      const { data: updated, error } = await supabase
        .from('files')
        .update({ folder_id: data.destinationFolderId })
        .eq('id', data.fileId)
        .select('id')
      if (error) throw error
      if (!updated || updated.length === 0) {
        throw new Error('Permission denied: cannot move this file to the selected folder')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
      queryClient.invalidateQueries({ queryKey: ['folder-count'] })
    },
  })
}

export function useMoveFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['move-folder'],
    mutationFn: async (data: { folderId: string; destinationFolderId: string | null }) => {
      const { data: updated, error } = await supabase
        .from('folders')
        .update({ parent_id: data.destinationFolderId })
        .eq('id', data.folderId)
        .select('id')
      if (error) throw error
      if (!updated || updated.length === 0) {
        throw new Error('Permission denied: cannot move this folder to the selected destination')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
      queryClient.invalidateQueries({ queryKey: ['folder-count'] })
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

// Share Queries and Mutations

async function fetchResourceShares(
  resourceType: 'file' | 'folder',
  resourceId: string
): Promise<Share[]> {
  console.log('[fetchResourceShares]', { resourceType, resourceId })
  // Fetch shares
  const { data: shares, error: sharesError } = await supabase
    .from('shares')
    .select('id, resource_type, resource_id, shared_with_user_id, permission, created_by')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)

  console.log('[fetchResourceShares] result', { shares, sharesError })
  if (sharesError) throw new Error(`Failed to fetch shares: ${sharesError.message}`)
  if (!shares?.length) return []

  // Get unique user IDs
  const userIds = [...new Set(shares.map(s => s.shared_with_user_id).filter(Boolean))]

  // Fetch user emails
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email')
    .in('id', userIds)

  if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`)

  const emailMap = new Map(users?.map(u => [u.id, u.email]) ?? [])

  return shares.map((share) => ({
    id: share.id,
    resource_type: share.resource_type as 'file' | 'folder',
    resource_id: share.resource_id,
    shared_with_user_id: share.shared_with_user_id,
    permission: share.permission as SharePermission,
    created_by: share.created_by,
    shared_with_email: share.shared_with_user_id ? emailMap.get(share.shared_with_user_id) : undefined,
  }))
}

async function searchUsers(query: string): Promise<ShareableUser[]> {
  if (!query.trim()) return []

  const { data, error } = await supabase
    .from('users')
    .select('id, email')
    .ilike('email', `%${query}%`)
    .limit(10)

  if (error) throw error
  return data ?? []
}

export const resourceSharesOptions = (resourceType: 'file' | 'folder', resourceId: string) =>
  queryOptions({
    queryKey: ['resource-shares', resourceType, resourceId] as const,
    queryFn: () => fetchResourceShares(resourceType, resourceId),
    enabled: !!resourceId,
    retry: false,
    throwOnError: false,
  })

export function useResourceShares(resourceType: 'file' | 'folder', resourceId: string) {
  return useQuery(resourceSharesOptions(resourceType, resourceId))
}

// Get current user's permission level for a resource
// Returns 'owner' | 'edit' | 'comment' | 'view' | null
// Checks direct shares and inherited folder permissions
export function useMyPermission(
  resourceType: 'file' | 'folder',
  resourceId: string,
  ownerId: string
) {
  return useQuery({
    queryKey: ['my-permission', resourceType, resourceId] as const,
    queryFn: async (): Promise<'owner' | 'edit' | 'comment' | 'view' | null> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      // Check if owner
      if (ownerId === user.id) return 'owner'

      // Check direct shares for this user on this resource
      const { data: directShare } = await supabase
        .from('shares')
        .select('permission')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .eq('shared_with_user_id', user.id)
        .single()

      if (directShare) return directShare.permission as 'edit' | 'comment' | 'view'

      // Check inherited folder permissions by traversing up the tree
      let parentFolderId: string | null = null

      if (resourceType === 'file') {
        // Get the file's folder_id
        const { data: file } = await supabase
          .from('files')
          .select('folder_id')
          .eq('id', resourceId)
          .single()
        parentFolderId = file?.folder_id ?? null
      } else {
        // Get the folder's parent_id
        const { data: folder } = await supabase
          .from('folders')
          .select('parent_id')
          .eq('id', resourceId)
          .single()
        parentFolderId = folder?.parent_id ?? null
      }

      // Walk up the folder tree checking for shares
      while (parentFolderId) {
        const { data: folderShare } = await supabase
          .from('shares')
          .select('permission')
          .eq('resource_type', 'folder')
          .eq('resource_id', parentFolderId)
          .eq('shared_with_user_id', user.id)
          .single()

        if (folderShare) return folderShare.permission as 'edit' | 'comment' | 'view'

        // Get the next parent
        const { data: parentFolder } = await supabase
          .from('folders')
          .select('parent_id')
          .eq('id', parentFolderId)
          .single()

        parentFolderId = parentFolder?.parent_id ?? null
      }

      return null
    },
    enabled: !!resourceId,
    retry: false,
    throwOnError: false,
  })
}

export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: ['search-users', query] as const,
    queryFn: () => searchUsers(query),
    enabled: query.trim().length > 0,
    retry: false,
    throwOnError: false,
  })
}

export function useCreateShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['create-share'],
    mutationFn: async (data: {
      resourceType: 'file' | 'folder'
      resourceId: string
      sharedWithUserId: string
      permission: SharePermission
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const shareId = crypto.randomUUID()
      console.log('[createShare] inserting', { shareId, ...data, created_by: user.id })
      const { error } = await supabase.from('shares').insert({
        id: shareId,
        resource_type: data.resourceType,
        resource_id: data.resourceId,
        shared_with_user_id: data.sharedWithUserId,
        permission: data.permission,
        created_by: user.id,
      })
      console.log('[createShare] result', { error })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      console.log('[createShare] onSuccess, invalidating queries')
      queryClient.invalidateQueries({
        queryKey: ['resource-shares', variables.resourceType, variables.resourceId],
      })
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
      queryClient.invalidateQueries({ queryKey: ['my-permission'] })
    },
  })
}

export function useRemoveShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['remove-share'],
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.from('shares').delete().eq('id', shareId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-shares'] })
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
      queryClient.invalidateQueries({ queryKey: ['my-permission'] })
    },
  })
}

export function useUpdateSharePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['update-share-permission'],
    mutationFn: async (data: { shareId: string; permission: SharePermission }) => {
      const { error } = await supabase
        .from('shares')
        .update({ permission: data.permission })
        .eq('id', data.shareId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-shares'] })
      queryClient.invalidateQueries({ queryKey: ['my-permission'] })
    },
  })
}

// =============================================================================
// COMMENTS
// =============================================================================

async function fetchFileComments(fileId: string): Promise<Comment[]> {
  const { data: comments, error: commentsError } = await supabase
    .from('comments')
    .select('id, file_id, user_id, content, created_at')
    .eq('file_id', fileId)
    .order('created_at', { ascending: true })

  if (commentsError) throw new Error(`Failed to fetch comments: ${commentsError.message}`)
  if (!comments?.length) return []

  // Get unique user IDs
  const userIds = [...new Set(comments.map(c => c.user_id))]

  // Fetch user emails
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email')
    .in('id', userIds)

  if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`)

  const emailMap = new Map(users?.map(u => [u.id, u.email]) ?? [])

  return comments.map((comment) => ({
    id: comment.id,
    file_id: comment.file_id,
    user_id: comment.user_id,
    content: comment.content,
    created_at: comment.created_at,
    user_email: emailMap.get(comment.user_id),
  }))
}

export const fileCommentsOptions = (fileId: string) =>
  queryOptions({
    queryKey: ['file-comments', fileId] as const,
    queryFn: () => fetchFileComments(fileId),
    enabled: !!fileId,
    retry: false,
    throwOnError: false,
  })

export function useFileComments(fileId: string) {
  return useQuery(fileCommentsOptions(fileId))
}

export function useCreateComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['create-comment'],
    mutationFn: async (data: { fileId: string; content: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { error } = await supabase.from('comments').insert({
        id: crypto.randomUUID(),
        file_id: data.fileId,
        user_id: user.id,
        content: data.content,
      })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['file-comments', variables.fileId] })
    },
  })
}

export function useDeleteComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['delete-comment'],
    mutationFn: async (data: { commentId: string; fileId: string }) => {
      const { error } = await supabase.from('comments').delete().eq('id', data.commentId)
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['file-comments', variables.fileId] })
    },
  })
}

// =============================================================================
// LINK SHARES
// =============================================================================

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let token = ''
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

async function fetchResourceLinkShares(
  resourceType: 'file' | 'folder',
  resourceId: string
): Promise<LinkShare[]> {
  const { data, error } = await supabase
    .from('link_shares')
    .select('id, resource_type, resource_id, token, permission, expires_at, created_by')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch link shares: ${error.message}`)

  return (data ?? []).map((ls) => ({
    id: ls.id,
    resource_type: ls.resource_type as 'file' | 'folder',
    resource_id: ls.resource_id,
    token: ls.token,
    permission: ls.permission as 'view' | 'edit',
    expires_at: ls.expires_at,
    created_by: ls.created_by,
  }))
}

export const resourceLinkSharesOptions = (resourceType: 'file' | 'folder', resourceId: string) =>
  queryOptions({
    queryKey: ['resource-link-shares', resourceType, resourceId] as const,
    queryFn: () => fetchResourceLinkShares(resourceType, resourceId),
    enabled: !!resourceId,
    retry: false,
    throwOnError: false,
  })

export function useResourceLinkShares(resourceType: 'file' | 'folder', resourceId: string) {
  return useQuery(resourceLinkSharesOptions(resourceType, resourceId))
}

export function useCreateLinkShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['create-link-share'],
    mutationFn: async (data: {
      resourceType: 'file' | 'folder'
      resourceId: string
      permission: 'view' | 'edit'
      expiresAt?: Date | null
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const token = generateToken()
      const { error } = await supabase.from('link_shares').insert({
        id: crypto.randomUUID(),
        resource_type: data.resourceType,
        resource_id: data.resourceId,
        token,
        permission: data.permission,
        expires_at: data.expiresAt?.toISOString() ?? null,
        created_by: user.id,
      })
      if (error) throw error
      return token
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['resource-link-shares', variables.resourceType, variables.resourceId],
      })
    },
  })
}

export function useDeleteLinkShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['delete-link-share'],
    mutationFn: async (linkShareId: string) => {
      const { error } = await supabase.from('link_shares').delete().eq('id', linkShareId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-link-shares'] })
    },
  })
}
