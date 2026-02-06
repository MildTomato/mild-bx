"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { VscAccount, VscLoading } from "react-icons/vsc";
import { useSearchUsers } from "@/lib/queries";
import type { ShareableUser } from "@/lib/types";
import { Input } from "@/components/ui/input";

const EMPTY_EXCLUDE_IDS: string[] = [];

type UserSearchProps = {
  onSelect: (user: ShareableUser) => void;
  excludeUserIds?: string[];
  placeholder?: string;
};

export function UserSearch({
  onSelect,
  excludeUserIds = EMPTY_EXCLUDE_IDS,
  placeholder = "Search users by email...",
}: UserSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: users, isPending, error } = useSearchUsers(query);

  const excludeSet = useMemo(() => new Set(excludeUserIds), [excludeUserIds]);
  const filteredUsers = useMemo(
    () => (users ?? []).filter((user) => !excludeSet.has(user.id)),
    [users, excludeSet]
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(user: ShareableUser) {
    onSelect(user);
    setQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <VscAccount className="text-muted-foreground shrink-0" />
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="flex-1"
        />
        {isPending && query.trim() && (
          <VscLoading className="text-muted-foreground animate-spin shrink-0" />
        )}
      </div>

      {isOpen && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {error ? (
            <div className="px-3 py-2 text-destructive text-sm">Failed to search users</div>
          ) : isPending ? (
            <div className="px-3 py-2 text-muted-foreground text-sm">Searching...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-sm">No users found</div>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
              >
                <VscAccount className="text-muted-foreground shrink-0" />
                <span className="truncate">{user.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
