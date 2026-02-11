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

const SETUP = `# Setup: create demo directory (hidden from recording)
Hide
Type "rm -rf ../../../demos/recordings && mkdir -p ../../../demos/recordings && cd ../../../demos/recordings && rm -rf ./supabase ./.env"
Enter
Sleep 1s
Type "clear"
Enter
Sleep 500ms
Show`;

/**
 * Local development — picks "Local development" from gateway, instant scaffolding
 */
export const initLocalFixture: TapeFixture = {
  category: "INTERACTIVE",
  height: 600,
  tapeBody: `${SETUP}

# Start init
Type@50ms "supa init"
Enter
Sleep 4s

# Gateway: "How would you like to develop?" → Local development (already selected)
Enter
Sleep 3s`,
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
Sleep 4s

# Gateway: "How would you like to develop?" → Connect to existing project
Down
Sleep 300ms
Enter
Sleep 8s

# Organization prompt: "Use existing"
Enter
Sleep 2s

# Select organization
Type@80ms "Docmrk"
Sleep 1s
Enter
Sleep 6s

# Project prompt: "Use existing"
Enter
Sleep 2s

# Select project: browse and pick
Down
Sleep 400ms
Up
Sleep 400ms
Enter
Sleep 2s

# Schema management: accept default (Declarative)
Enter
Sleep 1s

# Config source: accept default (In code)
Enter
Sleep 2s

# Workflow profile: browse and pick solo
Sleep 500ms
Down
Sleep 800ms
Up
Sleep 600ms
Enter
Sleep 5s`,
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
Sleep 4s

# Gateway: "How would you like to develop?" → Create a new project
Down
Sleep 300ms
Down
Sleep 300ms
Enter
Sleep 8s

# Organization prompt: "Use existing"
Enter
Sleep 2s

# Select organization: search and select
Type@80ms "Docmrk"
Sleep 1s
Enter
Sleep 6s

# Project prompt: "Create new"
Down
Sleep 300ms
Enter
Sleep 2s

# Project name
Type@80ms "${randomSuffix}-delete-me"
Sleep 500ms
Enter
Sleep 2s

# Region: search and select
Type@80ms "us-east"
Sleep 1s
Enter
Sleep 2s

# Schema management: accept default (Declarative)
Enter
Sleep 1s

# Config source: accept default (In code)
Enter
Sleep 2s

# Workflow profile: browse through options
Sleep 500ms
Down
Sleep 800ms
Down
Sleep 800ms
Up
Sleep 800ms
Up
Sleep 600ms
Enter
Sleep 5s`,
};
