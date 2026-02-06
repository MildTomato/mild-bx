"use client";

import { motion } from "motion/react";

type SectionHeaderProps = {
  label: string;
  isSharedSection: boolean;
};

export function SectionHeader({ label, isSharedSection }: SectionHeaderProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div
        className={`px-4 py-2 text-xs font-medium uppercase tracking-wide ${
          isSharedSection
            ? "text-shared border-b border-shared/20"
            : "text-muted-foreground border-b border-border"
        }`}
      >
        {label}
      </div>
    </motion.div>
  );
}
