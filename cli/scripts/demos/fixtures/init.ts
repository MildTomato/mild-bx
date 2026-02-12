/**
 * Hand-crafted interactive tapes for `supa init`
 *
 * Three variants:
 * - init-local:   supa init → local development (instant, no auth)
 * - init-connect: supa init → connect to existing project
 * - init-create:  supa init → create a new project (the original demo)
 */

import type { TapeFixture } from "./index.js";

const randomSuffix = Math.random().toString(36).slice(2, 6);

/** init--local runs first: wipes and recreates recordings dir from scratch */
const SETUP_LOCAL = `Hide
Type "rm -rf ../../../demos/recordings && mkdir -p ../../../demos/recordings && cd ../../../demos/recordings"
Enter
Sleep 1s
Type "clear"
Enter
Sleep 500ms
Show`;

/** Other init tapes: cd into recordings, clear supabase dir only (keep .env) */
const SETUP = `Hide
Type "cd ../../../demos/recordings && rm -rf ./supabase"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 500ms
Show`;

/**
 * Local development — picks "Local development" from gateway,
 * declines template, picks schema management
 */
export const initLocalFixture: TapeFixture = {
  category: "INTERACTIVE",
  height: 800,
  tapeBody: `${SETUP_LOCAL}

# Start init
Type@50ms "supa init"
Enter
Sleep 3s

# Gateway: "How would you like to develop?" → Local development (already selected)
Enter
Sleep 3s

# "Start from a starter template?" → No (already selected)
Enter
Sleep 300ms

# Schema management: accept default (Declarative)
Enter
Sleep 5s`,
};

/**
 * Connect to existing project — picks "Connect to existing project" from gateway,
 * then goes through the existing wizard flow
 */
export const initConnectFixture: TapeFixture = {
  category: "INTERACTIVE",
  height: 800,
  tapeBody: `${SETUP}

# Start init
Type@50ms "supa init"
Enter
Sleep 3s

# Gateway: "How would you like to develop?" → Connect to existing project
Down
Sleep 150ms
Enter
Sleep 6s

# Organization prompt: "Use existing"
Enter
Sleep 300ms

# Select organization (only one, just confirm)
Enter
Sleep 4s

# Project prompt: "Use existing"
Enter
Sleep 300ms

# Select project: browse and pick
Down
Sleep 200ms
Up
Sleep 200ms
Enter
Sleep 3s

# "Start from a starter template?" → No (already selected)
Enter
Sleep 300ms

# Schema management: accept default (Declarative)
Enter
Sleep 300ms

# Config source: accept default (In code)
Enter
Sleep 300ms

# Workflow profile: browse and pick solo
Down
Sleep 200ms
Up
Sleep 200ms
Enter
Sleep 4s`,
};

/**
 * Create a new project — picks "Create a new project" from gateway,
 * then goes through the existing wizard flow creating a new project
 */
export const initCreateFixture: TapeFixture = {
  category: "INTERACTIVE",
  height: 800,
  tapeBody: `${SETUP}

# Start init
Type@50ms "supa init"
Enter
Sleep 3s

# Gateway: "How would you like to develop?" → Create a new project
Down
Sleep 150ms
Down
Sleep 150ms
Enter
Sleep 6s

# Organization prompt: "Use existing"
Enter
Sleep 300ms

# Select organization (only one, just confirm)
Enter
Sleep 4s

# Project prompt: "Create new"
Down
Sleep 150ms
Enter
Sleep 300ms

# Project name
Type@80ms "${randomSuffix}-delete-me"
Sleep 200ms
Enter
Sleep 300ms

# Region: search and select
Type@80ms "us-east"
Sleep 300ms
Enter
Sleep 3s

# "Start from a starter template?" → No (already selected)
Enter
Sleep 300ms

# Schema management: accept default (Declarative)
Enter
Sleep 300ms

# Config source: accept default (In code)
Enter
Sleep 300ms

# Workflow profile: browse through options
Down
Sleep 200ms
Down
Sleep 200ms
Up
Sleep 200ms
Up
Sleep 200ms
Enter
Sleep 4s`,
};
