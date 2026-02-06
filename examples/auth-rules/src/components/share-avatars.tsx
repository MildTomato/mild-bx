"use client";

import { useResourceShares } from "@/lib/queries";
import { useFileBrowser } from "@/lib/file-browser-context";
import { stringToColor, getInitials } from "@/lib/avatar-utils";
import type { Folder, File } from "@/lib/types";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

type ShareAvatarsProps = {
  resource: Folder | File;
  resourceType: "folder" | "file";
};

export function ShareAvatars({ resource, resourceType }: ShareAvatarsProps) {
  const { data: shares, isPending } = useResourceShares(resourceType, resource.id);
  const { openShareDialog } = useFileBrowser();

  if (isPending || !shares || shares.length === 0) {
    return null;
  }

  const maxVisible = 3;
  const visibleShares = shares.slice(0, maxVisible);
  const remainingCount = shares.length - maxVisible;

  return (
    <div
      className="flex items-center -space-x-1 cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        openShareDialog(resource, resourceType);
      }}
    >
      {visibleShares.map((share) => (
        <HoverCard key={share.id} openDelay={200}>
          <HoverCardTrigger asChild>
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white ring-1 ring-background"
              style={{ backgroundColor: stringToColor(share.shared_with_email ?? share.id) }}
            >
              {getInitials(share.shared_with_email ?? "?")}
            </div>
          </HoverCardTrigger>
          <HoverCardContent className="w-48 p-3" align="start">
            <div className="space-y-1">
              <p className="text-sm font-medium truncate">
                {share.shared_with_email ?? "Unknown user"}
              </p>
              <p className="text-xs text-muted-foreground capitalize">
                {share.permission} access
              </p>
            </div>
          </HoverCardContent>
        </HoverCard>
      ))}
      {remainingCount > 0 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium bg-muted text-muted-foreground ring-1 ring-background">
          +{remainingCount}
        </div>
      )}
    </div>
  );
}
