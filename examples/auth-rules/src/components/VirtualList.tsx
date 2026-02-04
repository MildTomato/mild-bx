'use client'

import { useRef, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

type VirtualListProps<T> = {
  items: T[]
  hasNextPage: boolean
  fetchNextPage: () => void
  isFetchingNextPage: boolean
  renderItem: (item: T, index: number) => React.ReactNode
  getItemKey: (item: T, index: number) => string | number
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 px-4 py-1 animate-pulse">
      <div className="w-4 h-4 bg-border rounded" />
      <div className="flex-1">
        <div className="h-3 bg-border rounded" style={{ width: '40%' }} />
      </div>
      <div className="w-16 h-3 bg-border rounded" />
    </div>
  )
}

export function VirtualList<T>({
  items,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  renderItem,
  getItemKey,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32, // Fixed row height
    overscan: 5,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Trigger load more when reaching bottom
  useEffect(() => {
    const lastItem = virtualItems.at(-1)
    if (
      lastItem &&
      lastItem.index >= items.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage()
    }
  }, [virtualItems, hasNextPage, isFetchingNextPage, fetchNextPage, items.length])

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const isLoaderRow = virtualRow.index >= items.length

          return (
            <div
              key={isLoaderRow ? 'loader' : getItemKey(items[virtualRow.index], virtualRow.index)}
              className="virtual-item"
              style={{
                position: 'absolute',
                top: virtualRow.start,
                height: virtualRow.size,
                width: '100%',
              }}
            >
              {isLoaderRow ? (
                <LoadingRow />
              ) : (
                renderItem(items[virtualRow.index], virtualRow.index)
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
