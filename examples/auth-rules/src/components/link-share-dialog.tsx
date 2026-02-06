"use client";

import { useState } from "react";
import { VscLink, VscCopy, VscCheck, VscLock } from "react-icons/vsc";
import { motion } from "motion/react";
import type { Folder, File } from "@/lib/types";
import {
  useResourceLinkShares,
  useCreateLinkShare,
  useDeleteLinkShare,
} from "@/lib/queries";

type LinkShareDialogProps = {
  resource: Folder | File;
  resourceType: "folder" | "file";
  onClose: () => void;
};

function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/share/${token}`;
}

export function LinkShareDialog({ resource, resourceType, onClose }: LinkShareDialogProps) {
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [copied, setCopied] = useState(false);

  const { data: linkShares, isPending } = useResourceLinkShares(resourceType, resource.id);
  const createMutation = useCreateLinkShare();
  const deleteMutation = useDeleteLinkShare();

  const activeLink = linkShares?.[0]; // Use first/most recent link
  const isEnabled = !!activeLink;

  async function handleToggle() {
    if (isEnabled && activeLink) {
      // Disable - delete the link
      await deleteMutation.mutateAsync(activeLink.id);
    } else {
      // Enable - create a new link
      await createMutation.mutateAsync({
        resourceType,
        resourceId: resource.id,
        permission,
        expiresAt: null,
      });
    }
  }

  async function handleCopy() {
    if (!activeLink) return;
    const url = buildShareUrl(activeLink.token);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handlePermissionChange(newPermission: "view" | "edit") {
    setPermission(newPermission);
    if (isEnabled && activeLink) {
      // Delete old link and create new one with updated permission
      await deleteMutation.mutateAsync(activeLink.id);
      await createMutation.mutateAsync({
        resourceType,
        resourceId: resource.id,
        permission: newPermission,
        expiresAt: null,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-bg border border-border rounded-lg shadow-xl w-full max-w-sm mx-4"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <VscLink className="text-accent" />
            <h2 className="font-medium">Share link</h2>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Resource name */}
          <p className="text-sm text-fg-muted truncate">
            {resourceType === "folder" ? "Folder" : "File"}: <span className="text-fg">{resource.name}</span>
          </p>

          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isEnabled ? (
                <VscLink className="text-accent" />
              ) : (
                <VscLock className="text-fg-muted" />
              )}
              <span className="text-sm">
                {isEnabled ? "Anyone with the link" : "Only people invited"}
              </span>
            </div>
            <button
              onClick={handleToggle}
              disabled={isPending || createMutation.isPending || deleteMutation.isPending}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                isEnabled ? "bg-accent" : "bg-border"
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  isEnabled ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          {/* Permission selector - only shown when enabled */}
          {isEnabled && (
            <div className="flex items-center gap-3 pl-6">
              <span className="text-sm text-fg-muted">can</span>
              <select
                value={activeLink?.permission ?? permission}
                onChange={(e) => handlePermissionChange(e.target.value as "view" | "edit")}
                disabled={createMutation.isPending || deleteMutation.isPending}
                className="bg-bg border border-border rounded px-2 py-1 text-sm disabled:opacity-50"
              >
                <option value="view">view</option>
                <option value="edit">edit</option>
              </select>
            </div>
          )}

          {/* Copy link button - only shown when enabled */}
          {isEnabled && activeLink && (
            <button
              onClick={handleCopy}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded hover:bg-border flex items-center justify-center gap-2 text-sm"
            >
              {copied ? (
                <>
                  <VscCheck className="w-4 h-4 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <VscCopy className="w-4 h-4" />
                  Copy link
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
