export type Folder = {
  id: string
  name: string
  parent_id: string | null
  owner_id: string
}

export type File = {
  id: string
  name: string
  folder_id: string | null
  content: string | null
  owner_id: string
  size: number
  created_at: string
}

export type FolderPage = {
  folders: Folder[]
  files: File[]
  nextCursor: string | null
  prevCursor: string | null
}
