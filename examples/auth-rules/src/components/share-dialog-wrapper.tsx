"use client";

import { AnimatePresence } from "motion/react";
import { useFileBrowser } from "@/lib/file-browser-context";
import { ShareDialog } from "./share-dialog";
import { LinkShareDialog } from "./link-share-dialog";

export function ShareDialogWrapper() {
  const { shareTarget, closeShareDialog, linkShareTarget, closeLinkShareDialog } = useFileBrowser();

  return (
    <>
      <ShareDialog
        open={!!shareTarget}
        onOpenChange={(open) => !open && closeShareDialog()}
        resource={shareTarget?.resource ?? null}
        resourceType={shareTarget?.type ?? "file"}
      />
      <AnimatePresence>
        {linkShareTarget && (
          <LinkShareDialog
            resource={linkShareTarget.resource}
            resourceType={linkShareTarget.type}
            onClose={closeLinkShareDialog}
          />
        )}
      </AnimatePresence>
    </>
  );
}
