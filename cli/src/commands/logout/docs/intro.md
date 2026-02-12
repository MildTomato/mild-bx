<DemoVideo id="supa-logout" />

Remove your stored credentials from the system keychain.

After logging out, you need to run `supa login` again to access your projects.

## What happens on logout

When you log out:

- Your access token is removed from the system keychain
- The token created during `supa login` remains active in your Supabase account
- To revoke the token completely, delete it from your
  [dashboard settings](https://supabase.com/dashboard/account/tokens)

> **Note:** If you're using an environment variable (`SUPABASE_ACCESS_TOKEN`),
> logging out doesn't affect it. Unset the variable separately if needed.
