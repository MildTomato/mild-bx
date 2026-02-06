"use client";

import { AnimatePresence, motion } from "motion/react";
import { VscGlobe } from "react-icons/vsc";
import type { Folder } from "@/lib/types";
import { useResourceShares } from "@/lib/queries";
import { stringToColor, getInitials } from "@/lib/avatar-utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

type SharedFolderBannerProps = {
  folder: Folder;
  isSharedWithMe: boolean;
};

export function SharedFolderBanner({ folder, isSharedWithMe }: SharedFolderBannerProps) {
  const { data: shares } = useResourceShares("folder", folder.id);

  const shouldShow = isSharedWithMe || (shares && shares.length > 0);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-2 bg-shared-bg border-b border-shared/20">
      <VscGlobe className="text-shared shrink-0" />
      <span className="text-shared text-sm">
        {isSharedWithMe ? "This folder is shared with you" : "This folder is shared"}
      </span>
      {!isSharedWithMe && shares && shares.length > 0 && (
        <div className="flex items-center -space-x-1 ml-auto">
          {shares.slice(0, 5).map((share) => (
            <HoverCard key={share.id} openDelay={200}>
              <HoverCardTrigger asChild>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white ring-2 ring-background cursor-pointer"
                  style={{ backgroundColor: stringToColor(share.shared_with_email ?? share.id) }}
                >
                  {getInitials(share.shared_with_email ?? "?")}
                </div>
              </HoverCardTrigger>
              <HoverCardContent className="w-48 p-3" align="end">
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
          {shares.length > 5 && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium bg-muted text-muted-foreground ring-2 ring-background">
              +{shares.length - 5}
            </div>
          )}
        </div>
      )}
    </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
