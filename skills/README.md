# Supabase DX Skills

AI/LLM skills for assistants like Cursor and Codex to help users with Supabase development.

## Available Skills

- **supabase-cli** - How to use the Supabase DX CLI (supa command)
- **supabase-workflows** - Guidance on development workflows (git vs dashboard, local vs preview vs remote)

## Installation

Copy the skill folder to your Cursor/Codex skills directory:

```bash
# For Cursor
cp -r supabase-cli ~/.cursor/skills/

# For Codex
cp -r supabase-cli ~/.codex/skills/
```

## Usage

Once installed, your AI assistant will automatically have context about:

- How to use the `supa` CLI commands
- How to configure profiles in `./supabase/config.toml`
- Best practices for Supabase development workflows
