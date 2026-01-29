# Supabase DX

Experimental CLI + VS Code extension for Supabase developer experience.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build everything
pnpm build

# Link CLI globally
cd cli && npm link

# Run from anywhere
supa-demo --help
```

## CLI Commands

```bash
supa-demo login               # Authenticate with Supabase
supa-demo projects            # List your projects
supa-demo pull                # Pull remote state to local
supa-demo push                # Push local changes to remote
supa-demo watch               # Watch for changes
```

All commands support `--json` for machine-readable output.

## Project Structure

```
cli/          # Node.js CLI (Ink + Commander)
extension/    # VS Code extension
skills/       # AI skills documentation
examples/     # Sample project for testing
docs/         # Architecture docs
```

## Development

### CLI

```bash
cd cli
pnpm dev          # Watch mode (rebuilds on changes)
pnpm build        # Production build
pnpm test         # Run tests
```

After building, the CLI is available globally via the npm link.

### Extension

```bash
cd extension
pnpm dev          # Watch mode
pnpm build        # Production build
pnpm test         # Run tests
```

Press F5 in VS Code to launch the extension in debug mode.

## Configuration

Create `./supabase/config.toml` in your project:

```toml
[project]
id = "your-project-ref"

[profiles.local]
mode = "local"
branches = ["feature/*", "fix/*"]

[profiles.staging]
mode = "remote"
branches = ["staging", "main"]
```

## Authentication

```bash
# Interactive login
supa-demo login

# Or set environment variable
export SUPABASE_ACCESS_TOKEN=sbp_xxxxx
```

Get a token at: https://supabase.com/dashboard/account/tokens
