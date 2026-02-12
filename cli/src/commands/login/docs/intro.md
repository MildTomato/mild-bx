<DemoVideo id="supa-login" />

Authenticate with your Supabase account to access your projects.

The CLI stores your credentials securely in your system keychain. You only need
to log in once per machine.

## Interactive login

Run `supa login` to start the browser-based authentication flow:

1. Press Enter to open your browser
2. Log in to Supabase (or create an account)
3. Copy the verification code shown in the browser
4. Paste the code into your terminal

The CLI creates a named token (like `cli_user@hostname_timestamp`) that you can
manage in your [dashboard settings](https://supabase.com/dashboard/account/tokens).

## Token-based login

For CI/CD pipelines or headless environments, use a token directly with
`--token`. Get your access token from the
[Supabase dashboard](https://supabase.com/dashboard/account/tokens).

You can also set the token as an environment variable:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxxx
```

When set, the CLI uses this token automatically without requiring `supa login`.

## Headless environments

If your environment can't open a browser, use `--no-browser` to print the URL.
Open the printed URL on another device, complete the login, and enter the
verification code in your terminal.
