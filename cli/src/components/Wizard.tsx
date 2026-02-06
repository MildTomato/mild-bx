/**
 * Reusable Wizard Framework
 *
 * Clack-style step-by-step wizard with vertical rail.
 * Uses Ink's <Static> to keep completed steps on screen.
 *
 * Usage:
 *   const wizard = useWizard();
 *   wizard.complete("org", "Organization", "acme-corp");
 *
 *   <WizardFrame wizard={wizard} title="supa init">
 *     {wizard.renderActiveStep(() => (
 *       <ActiveStep title="Select org">
 *         <SelectInput ... />
 *       </ActiveStep>
 *     ))}
 *   </WizardFrame>
 */

import React, { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Box, Text, Static, useStdout } from "ink";
import { Spinner } from "./Spinner.js";

// ─────────────────────────────────────────────────────────────
// Symbols & Colors
// ─────────────────────────────────────────────────────────────

export const SYMBOLS = {
  completed: "◇",
  active: "◆",
  info: "●",
  rail: "│",
  railStart: "┌",
  railEnd: "└",
} as const;

export const COLORS = {
  completed: "green",
  active: "cyan",
  info: "blue",
  rail: "gray",
} as const;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CompletedStep {
  id: string;
  label: string;
  value: string;
  suffix?: string; // Rendered dim after value
}

interface StaticItem {
  id: string;
  type: "header" | "step";
  label?: string;
  value?: string;
  suffix?: string;
}

export interface WizardState {
  completedSteps: CompletedStep[];
  complete: (id: string, label: string, value: string, suffix?: string) => void;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useWizard(): WizardState {
  const [completedSteps, setCompletedSteps] = useState<CompletedStep[]>([]);

  const complete = useCallback((id: string, label: string, value: string, suffix?: string) => {
    setCompletedSteps((prev) => [...prev, { id, label, value, suffix }]);
  }, []);

  return { completedSteps, complete };
}

// ─────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────

export function Rail({ color = COLORS.rail }: { color?: string }) {
  return (
    <Box>
      <Text color={color}>{SYMBOLS.rail}</Text>
    </Box>
  );
}

export function RailBox({ children, color = COLORS.active }: { children: ReactNode; color?: string }) {
  return (
    <Box
      borderStyle="single"
      borderLeft={true}
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={color}
      paddingLeft={2}
    >
      {children}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────
// Step Components
// ─────────────────────────────────────────────────────────────

function CompletedStepRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <Box flexDirection="column">
      <Rail />
      <Box>
        <Text color={COLORS.completed}>{SYMBOLS.completed}</Text>
        <Text>  </Text>
        <Text dimColor>{label}:</Text>
        <Text> {value}</Text>
        {suffix && <Text dimColor> ({suffix})</Text>}
      </Box>
    </Box>
  );
}

interface ActiveStepProps {
  title: string;
  hint?: string;
  children: ReactNode;
}

export function ActiveStep({ title, hint, children }: ActiveStepProps) {
  return (
    <Box flexDirection="column">
      <Rail />
      <Box>
        <Text color={COLORS.active}>{SYMBOLS.active}</Text>
        <Text>  </Text>
        <Text>{title}</Text>
      </Box>
      {hint && (
        <Box>
          <Text color={COLORS.active}>{SYMBOLS.rail}</Text>
          <Text>  </Text>
          <Text dimColor>{hint}</Text>
        </Box>
      )}
      <Rail color={COLORS.active} />
      <RailBox>{children}</RailBox>
    </Box>
  );
}

interface LoadingStepProps {
  message: string;
}

export function LoadingStep({ message }: LoadingStepProps) {
  return (
    <Box flexDirection="column">
      <Rail />
      <Box>
        <Text color={COLORS.active}>{SYMBOLS.rail}</Text>
        <Text>  </Text>
        <Spinner message={message} />
      </Box>
    </Box>
  );
}

interface InfoStepProps {
  children: ReactNode;
}

export function InfoStep({ children }: InfoStepProps) {
  return (
    <Box flexDirection="column">
      <Rail />
      <Box>
        <Text color={COLORS.info}>{SYMBOLS.info}</Text>
        <Text>  </Text>
        <Text>{children}</Text>
      </Box>
    </Box>
  );
}

interface OutroProps {
  children: ReactNode;
}

export function Outro({ children }: OutroProps) {
  return (
    <Box flexDirection="column">
      <Rail />
      <Box>
        <Text color={COLORS.rail}>{SYMBOLS.railEnd}</Text>
        <Text>  </Text>
        <Text color="green">{children}</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────
// Frame (wraps entire wizard, handles Static)
// ─────────────────────────────────────────────────────────────

interface WizardFrameProps {
  title: string;
  subtitle?: string;
  wizard: WizardState;
  children: ReactNode;
}

export function WizardFrame({ title, subtitle, wizard, children }: WizardFrameProps) {
  const { write } = useStdout();
  const prevStepCount = useRef(wizard.completedSteps.length);

  // Clear extra lines when transitioning to a new step
  useEffect(() => {
    if (wizard.completedSteps.length > prevStepCount.current) {
      // Clear 30 lines below current position to remove old picker content
      write("\x1b[0J");
    }
    prevStepCount.current = wizard.completedSteps.length;
  }, [wizard.completedSteps.length, write]);

  const staticItems: StaticItem[] = [
    { id: "__header__", type: "header" },
    ...wizard.completedSteps.map((s) => ({
      id: s.id,
      type: "step" as const,
      label: s.label,
      value: s.value,
      suffix: s.suffix,
    })),
  ];

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item) => {
          if (item.type === "header") {
            return (
              <Box key={item.id} flexDirection="column">
                {subtitle && <Text dimColor>{subtitle}</Text>}
                <Box marginTop={subtitle ? 1 : 0}>
                  <Text color={COLORS.rail}>{SYMBOLS.railStart}</Text>
                  <Text>   </Text>
                  <Text bold>{title}</Text>
                </Box>
              </Box>
            );
          }
          return <CompletedStepRow key={item.id} label={item.label!} value={item.value!} suffix={item.suffix} />;
        }}
      </Static>

      {children}
    </Box>
  );
}
