"use client";

import { useState, useEffect } from "react";
import { VscSend, VscTrash } from "react-icons/vsc";
import { Button } from "@/components/ui/button";
import { useFileComments, useCreateComment, useDeleteComment } from "@/lib/queries";
import { stringToColor, getInitials } from "@/lib/avatar-utils";
import { supabase } from "@/lib/supabase";

type FileCommentsProps = {
  fileId: string;
  canComment: boolean;
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function FileComments({ fileId, canComment }: FileCommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const { data: comments, isPending, error } = useFileComments(fileId);
  const createCommentMutation = useCreateComment();
  const deleteCommentMutation = useDeleteComment();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await createCommentMutation.mutateAsync({ fileId, content: newComment.trim() });
      setNewComment("");
    } catch (err) {
      console.error("Failed to create comment:", err);
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await deleteCommentMutation.mutateAsync({ commentId, fileId });
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  }

  return (
    <div className="border-t border-border">
      <div className="px-4 py-2 bg-bg-secondary border-b border-border">
        <h3 className="text-sm font-medium text-fg-muted">Comments</h3>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {isPending && (
          <div className="px-4 py-3 text-sm text-fg-muted">Loading comments...</div>
        )}
        {error && (
          <div className="px-4 py-3 text-sm text-red-500">
            Failed to load comments: {error.message}
          </div>
        )}
        {comments && comments.length === 0 && (
          <div className="px-4 py-3 text-sm text-fg-muted italic">No comments yet</div>
        )}
        {comments?.map((comment) => (
          <div key={comment.id} className="px-4 py-3 border-b border-border last:border-b-0 group">
            <div className="flex items-start gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white shrink-0"
                style={{ backgroundColor: stringToColor(comment.user_email ?? comment.id) }}
              >
                {getInitials(comment.user_email ?? "?")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {comment.user_email ?? "Unknown"}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatRelativeTime(comment.created_at)}
                  </span>
                  {currentUserId === comment.user_id && (
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 text-fg-muted hover:text-red-500 transition-opacity"
                      title="Delete comment"
                    >
                      <VscTrash className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-fg mt-1 whitespace-pre-wrap">{comment.content}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {canComment && (
        <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-border flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm outline-none focus:border-fg-muted"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!newComment.trim() || createCommentMutation.isPending}
          >
            <VscSend className="w-4 h-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
