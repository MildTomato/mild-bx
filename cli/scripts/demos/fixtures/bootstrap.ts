/**
 * Hand-crafted interactive tape for `supa bootstrap`
 *
 * Scripts the interactive bootstrap flow:
 * template selection → download → done
 */

import type { TapeFixture } from "./index.js";

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
 * Interactive bootstrap — picks hono template, downloads it
 */
export const bootstrapFixture: TapeFixture = {
  category: "INTERACTIVE",
  height: 800,
  tapeBody: `${SETUP}

# Start bootstrap
Type@50ms "supa bootstrap"
Enter
Sleep 4s

# Template picker: type to filter, select hono
Type@80ms "hono"
Sleep 1s
Enter
Sleep 30s

# Wait for output
Sleep 5s`,
};
