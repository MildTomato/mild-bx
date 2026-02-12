/**
 * Hand-crafted interactive tapes for `supa init`
 *
 * Three variants:
 * - init-local:           supa init → local development (instant, no auth)
 * - init-local-template:  supa init → local → yes to template → pick one
 * - init-connect:         supa init → connect to existing project
 * - init-create:          supa init → create a new project (the original demo)
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

Type@50ms "supa init"
Enter
Sleep 2s

# Gateway → Local development (first option)
Enter
Sleep 500ms

# Template? → No
Enter
Sleep 100ms

# Schema management → Declarative
Enter
Sleep 5s`,
};

/**
 * Local development with template — picks "Local development" from gateway,
 * says Yes to template, picks one, then schema management
 */
export const initLocalTemplateFixture: TapeFixture = {
  category: "INTERACTIVE",
  height: 800,
  tapeBody: `${SETUP}

Type@50ms "supa init"
Enter
Sleep 2s

# Gateway → Local development (first option)
Enter
Sleep 500ms

# Template? → Yes (default is No, press Left to switch to Yes)
Left
Sleep 150ms
Enter
Sleep 3s

# Template picker: search for "hono" and select
Type@80ms "hono"
Sleep 500ms
Enter
Sleep 15s

# Schema management → Declarative
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

Type@50ms "supa init"
Enter
Sleep 2s

# Gateway → Connect to existing project
Down
Sleep 150ms
Enter
Sleep 2s

# Org → Use existing
Enter
Sleep 100ms

# Select org
Enter
Sleep 1s

# Project → Use existing
Enter
Sleep 100ms

# Select project: browse and pick
Down
Sleep 200ms
Up
Sleep 200ms
Enter
Sleep 500ms

# Template? → No
Enter
Sleep 100ms

# Schema management → Declarative
Enter
Sleep 100ms

# Config source → In code
Enter
Sleep 100ms

# Workflow profile: browse and pick solo
Down
Sleep 500ms
Up
Sleep 500ms
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

Type@50ms "supa init"
Enter
Sleep 2s

# Gateway → Create a new project
Down
Sleep 150ms
Down
Sleep 150ms
Enter
Sleep 2s

# Org → Use existing
Enter
Sleep 100ms

# Select org
Enter
Sleep 1s

# Project → Create new
Down
Sleep 150ms
Enter
Sleep 100ms

# Project name
Type@80ms "${randomSuffix}-delete-me"
Sleep 200ms
Enter
Sleep 100ms

# Region
Type@80ms "us-east"
Sleep 200ms
Enter
Sleep 500ms

# Template? → No
Enter
Sleep 100ms

# Schema management → Declarative
Enter
Sleep 100ms

# Config source → In code
Enter
Sleep 100ms

# Workflow profile: browse through options
Down
Sleep 500ms
Down
Sleep 500ms
Up
Sleep 500ms
Up
Sleep 500ms
Enter
Sleep 4s`,
};
