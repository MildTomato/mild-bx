# Auth Provider Commands

Manage OAuth providers for your Supabase project directly from the CLI.

## Overview

The `supa project auth-provider` command lets you configure and manage OAuth providers (Google, GitHub, Apple, etc.) for your project without using the Supabase dashboard.

## Features

- **Interactive setup**: Add providers with guided prompts
- **Secure by default**: Secrets are stored in `.env` and referenced via `env()` syntax in config
- **Full provider support**: All 23+ OAuth providers supported by Supabase Auth
- **List providers**: See which providers are configured and enabled
- **Enable/disable**: Toggle providers on and off without removing credentials

## Quick Start

```bash
# Add a provider interactively
supa project auth-provider add

# Add a specific provider
supa project auth-provider add google

# List all configured providers
supa project auth-provider list

# Enable/disable a provider
supa project auth-provider enable google
supa project auth-provider disable google
```

## How Secrets Work

When you add a provider, the CLI:

1. Writes the **secret** to `.env` (gitignored)
2. Writes the **config** to `supabase/config.json` with an environment reference: `"secret": "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`
3. Pushes the **actual secret value** to the remote project

This means:
- Your config file is safe to commit
- Secrets stay out of version control
- `supa project push` automatically resolves `env()` references

## Supported Providers

### Popular
- Google
- GitHub
- Apple

### Social
- Discord, Facebook, Twitter, Twitch
- LinkedIn, Spotify, Slack
- Notion, Zoom, Figma, Kakao

### Enterprise
- Azure AD
- GitLab
- Bitbucket
- Keycloak
- WorkOS

### Other
- Fly.io
- Email (Magic Link)
- Phone
- Anonymous

## Next Steps

- Configure a provider: `supa project auth-provider add`
- See all options: `supa project auth-provider add --help`
- Read about [config secrets](/docs/config/secrets)
