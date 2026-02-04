export type Folder = {
  id: string
  name: string
  parent_id: string | null
  owner_id: string
  is_shared_by_me?: boolean
  is_shared_with_me?: boolean
}

export type File = {
  id: string
  name: string
  folder_id: string | null
  content: string | null
  owner_id: string
  size: number
  created_at: string
  is_shared_by_me?: boolean
  is_shared_with_me?: boolean
}

export type FolderPage = {
  folders: Folder[]
  files: File[]
  nextCursor: string | null
  prevCursor: string | null
}

// Share types
export type SharePermission = 'view' | 'comment' | 'edit'

export type Share = {
  id: string
  resource_type: 'file' | 'folder'
  resource_id: string
  shared_with_user_id: string | null
  permission: SharePermission
  created_by: string
  shared_with_email?: string // joined from users table
}

export type ShareableUser = {
  id: string
  email: string
}

export type Comment = {
  id: string
  file_id: string
  user_id: string
  content: string
  created_at: string
  user_email?: string // joined from users table
}

export type LinkShare = {
  id: string
  resource_type: 'file' | 'folder'
  resource_id: string
  token: string
  permission: 'view' | 'edit'
  expires_at: string | null
  created_by: string
}
