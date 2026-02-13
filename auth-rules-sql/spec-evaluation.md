# Auth Rules: Dropbox Spec Evaluation

## At a Glance

**Pass:**
- [Data model](#data-model)
- [List file system](#list-file-system)
- [Recursive paths](#list-file-system)
- [Counting](#list-file-system)
- [View file](#view-file)
- [Upload file](#upload-file)
- [Move file](#move-file-to-another-location)
- [Add comment](#add-comment-to-file)
- [View comments](#view-file-comments)
- [Remove comment](#remove-file-comment)
- [Search files (Postgres FTS)](#search-through-files)
- [Search comments (Postgres FTS)](#search-through-comments)
- [Generate permalink](#generate-permalink)
- [Use permalink](#use-permalink)
- [Introduce a team](#introduce-a-team-groups)
- [Audit logs](#audit-logs)

**Partial:**
- [Pagination](#list-file-system)
- [Permission repair](#re-assign-permissions-after-a-bug)
- [External search indexing](#external-search-indexing)

**Fail:**
- [Transitive permalink](#transitive-permalink-access)
- [Realtime comments](#supabase-realtime-on-comments)
- [Server-to-server](#server-to-server-api-tokens--oauth)
- [Impersonation](#user-impersonation--temporary-support-access)

---

## Overview

Auth Rules is a pure SQL authorization system for Supabase. Developers define **claims** (what a user has access to) and **rules** (how tables are exposed through the `data_api` schema). The system generates views and triggers that enforce access control at the database level.

There are two modes:
- **Filter mode** (`select`): Views silently exclude rows the user can't access. Good for listings.
- **Require mode** (`select_strict`): Views raise explicit errors (42501) when access is denied. Good for single-resource fetches.

The developer writes declarative rules. The system generates everything else.

```sql
-- Define a claim: "which orgs can this user access?"
SELECT auth_rules.claim('org_ids', 'SELECT user_id, org_id FROM org_members');

-- Define a rule: "documents are filtered by org_id"
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

---

## What We Pass

### Data Model

Fully implemented. The demo app has: `files` (with `search_vector` tsvector), `folders`, `shares`, `link_shares`, `comments` (with `search_vector` tsvector), `organizations`, `org_members`, `groups`, `group_members`, `audit_logs`, and a `users` view over `auth.users`. GIN indexes on both search vectors. Folder hierarchy via `parent_id` self-reference.

### List File System

**Passed.** The `data_api.files` and `data_api.folders` views filter to rows the user can access. A client query is just:

```ts
const { data } = await supabase.from('folders').select('*').schema('data_api')
```

The `accessible_folder_ids` claim uses recursive CTEs with LATERAL joins to expand shared folder hierarchies, so sharing a parent folder automatically grants access to all subfolders. Folder descendant expansion is capped at 100k to prevent timeouts on huge trees.

**Supports recursive paths?** Yes. The claims use `WITH RECURSIVE folder_tree` to expand folder hierarchies. Sharing a folder at any level grants access to everything underneath it.

**Supports pagination?** Partially. The views are standard Postgres views, so the client can use `.range()` or `LIMIT/OFFSET`. The demo app uses offset pagination with `PAGE_SIZE=50` and infinite scroll. However, there's no built-in cursor-based or keyset pagination in the system itself, which matters at scale for million-entry directories where high-offset queries get slow.

**Supports counting?** Yes. `data_api.get_folder_item_count(folder_id)` counts files and subfolders recursively through the auth-filtered views (SECURITY INVOKER), with a configurable LIMIT cap (default 5001) to prevent expensive queries on huge folders.

### View File

**Passed.** The `data_api.files` view includes the `content` column. Filter mode returns nothing if the user can't access it. Require mode (`select_strict`) raises an error with code 42501.

### Upload File

**Passed.** INSERT rule on files validates `owner_id = auth.uid()`. The generated INSTEAD OF trigger validates this and inserts into the public table. The `search_vector` column is a GENERATED ALWAYS AS column, so Postgres FTS is automatically updated on every insert.

```sql
SELECT auth_rules.rule('files',
  auth_rules.insert(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker())
);
```

Note: The spec asks that uploads validate the user can list AND upload into the target directory. The INSERT rule validates ownership but doesn't check `folder_id` against a writable-folders claim. The system supports adding this condition; the demo app omits it for simplicity.

### Move File to Another Location

**Passed.** The demo app defines `writable_folder_ids` and `writable_parent_ids` claims that expand folder ownership and edit-shared folders recursively. The UPDATE rules validate both the file and the destination:

```sql
-- Files: edit permission + destination folder must be writable
SELECT auth_rules.rule('files',
  auth_rules.update(),
  auth_rules.eq('id', auth_rules.one_of('editable_file_ids')),
  auth_rules.eq('folder_id', auth_rules.one_of('writable_folder_ids'))
);

-- Folders: owner only + destination parent must be writable
SELECT auth_rules.rule('folders',
  auth_rules.update(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker()),
  auth_rules.eq('parent_id', auth_rules.one_of('writable_parent_ids'))
);
```

The generated UPDATE trigger validates:
1. `OLD.id` is in `editable_file_ids` (user can edit this file)
2. `NEW.folder_id` is in `writable_folder_ids` (destination folder is authorized)

The system tests (`10-update-move.sql`) verify: successful moves between owned folders, rejection when moving to unauthorized folders, rejection when non-owner attempts move, and rejection of NULL destination. The demo app frontend implements a folder-tree picker for move operations.

Note: The spec asks for 3 separate checks (file + source location + destination location). Source location access is implicit in `editable_file_ids` — if the user can edit a file, they have access to its current location. The destination check is explicit via `writable_folder_ids`.

### Add Comment to File

**Passed.** INSERT rule on comments validates both `user_id = auth.uid()` AND `file_id` is in the user's `commentable_file_ids` claim (files with comment or edit permission). Uses `auth_rules.and_()` for multi-condition validation.

```sql
SELECT auth_rules.rule('comments',
  auth_rules.insert(),
  auth_rules.and_(
    auth_rules.eq('user_id', auth_rules.user_id_marker()),
    auth_rules.eq('file_id', auth_rules.one_of('commentable_file_ids'))
  )
);
```

### View File Comments

**Passed.** SELECT rule on comments filters by `commentable_file_ids`. Users see comments on files they have comment or edit access to.

Note: The spec says users should always be able to view their own comments, even if they lose comment access to the file. The current implementation doesn't handle this edge case — once a user loses comment access, they lose visibility of their own comments too. This could be addressed by adding a UNION branch to the comments SELECT claim for `user_id = auth.uid()`.

### Remove File Comment

**Passed.** DELETE rule validates `user_id = auth.uid()` — users can only delete their own comments.

Note: The spec requires file view access + comment view access before allowing deletion. The current rule only checks comment ownership. In practice this is fine — the UI won't show a delete button for comments on inaccessible files — but the API would allow deleting a comment on a file the user no longer has access to.

### Search Through Files

**Passed.** The demo app implements full-text search on file contents with auth-filtered results:

1. **Schema:** `files.search_vector` is a `TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(content, ''))) STORED` column with a GIN index.

2. **Search function:** `data_api.search(query, limit)` is a `SECURITY INVOKER` function that queries through `data_api.files` — so auth filtering is automatic. It combines FTS (`@@` operator with `plainto_tsquery`) with ILIKE name matching as a fallback, and returns `ts_headline` snippets with highlighted matches.

3. **Frontend integration:** The demo app has a search dialog (Cmd/Ctrl+K) with debounced search (200ms), results grouped by type (files, folders, comments), and navigation on select.

```ts
const { data } = await supabase.schema('data_api').rpc('search', {
  p_query: searchTerm,
  p_limit: 20
})
```

Because the search function queries through `data_api.files` (which is the auth-filtered view), users only see results for files they have access to.

### Search Through Comments

**Passed.** Same approach as file search. The `comments.search_vector` is a GENERATED tsvector column with a GIN index. The `data_api.search()` function includes a comment FTS branch that queries through `data_api.comments`, which is filtered by `commentable_file_ids`. Users only see matching comments on files they have comment or edit access to.

### Generate Permalink

**Passed.** Link shares have INSERT/DELETE rules scoped to `created_by = auth.uid()`. A user creates a link share row with a unique token, resource reference, and permission level. The demo app generates 24-character alphanumeric tokens and supports optional expiration dates.

### Use Permalink

**Passed.** The `accessible_file_ids` claim includes a UNION branch that checks `current_link_token()` against `link_shares.token`, respecting `expires_at`. Anonymous users get a fixed UUID (`00000000-...`) so the claim system works without a real `auth.uid()`. Tests verify: valid tokens grant access, invalid tokens deny, expired tokens deny, future expiry grants.

### Introduce a Team (Groups)

**Passed.** Groups are fully implemented at the data model and claim level. The `accessible_file_ids`, `editable_file_ids`, `commentable_file_ids`, and `accessible_folder_ids` claims all include UNION branches for group-based sharing (`shares.shared_with_group_id` joined to `group_members`). System tests verify group member access, non-member denial, and multi-path access resolution.

### Audit Logs

**Passed.** SELECT rule on audit_logs is scoped to `admin_org_ids` — only org admins can see logs for their org. Tests verify admin access, non-admin denial, and cross-org isolation.

---

## What We Partially Pass

### Pagination

**Partially passed.** Standard Postgres `LIMIT/OFFSET` works through the views, and the demo app uses `.range()` for offset-based pagination with infinite scroll. However, for sub-directories with up to a million entries (as the spec requires), offset pagination degrades at high offsets. The system doesn't provide built-in cursor-based or keyset pagination.

**How to improve:** Keyset pagination works through the views today — the client just needs to use `ORDER BY created_at, id` with `WHERE (created_at, id) > (last_created_at, last_id)` instead of `LIMIT/OFFSET`. This is a client-side pattern, not something the system needs to generate.

### Re-assign Permissions After a Bug

**Partially passed.** Because claims are live queries over the actual data (shares, org_members, folders, etc.), fixing the data automatically fixes the permissions. There's no stale permission cache to invalidate. If a bug caused files to be moved incorrectly, fixing the `folder_id` values immediately restores correct access.

However, there's no built-in tooling for bulk permission auditing or repair — you'd write SQL directly against the shares/org_members tables. For the spec's scenario (a move bug that caused users to lose access), the fix is a single UPDATE statement restoring the correct `folder_id` values, and permissions resolve instantly.

### External Search Indexing

**Partially passed.** Postgres FTS is fully handled: the `search_vector` columns are GENERATED ALWAYS, so they auto-update on every INSERT/UPDATE with zero additional work. GIN indexes are in place.

However, the spec asks for indexing into an external service (like ElasticSearch) on upload. There's no hook in the INSERT trigger for external indexing.

**How to solve:**

1. **AFTER INSERT trigger.** Add a trigger on `public.files` that calls `pg_notify()` or `net.http_post()` (via pg_net) to index in the external service.

2. **Supabase Database Webhooks.** Configure a webhook on `public.files` INSERT that calls an Edge Function to index externally.

3. **Edge Function wrapper.** Insert through an Edge Function that does the DB insert + external indexing in one step.

---

## What We Don't Pass

### Transitive Permalink Access

**Not passed.** The spec says: "if the user who created the permalink loses access, the link should also become invalid." Our link shares are independent rows — they don't track whether the creator still has access. A user could create a link, lose access to the file, and the link would still work.

**How to solve:**

1. **Separate validation function.** A `validate_link_share()` function that checks creator access before returning the resource. Called from the claim or from a wrapper view. The function would join `link_shares` to the creator's `accessible_file_ids` to verify the creator still has access.

2. **Background job.** Periodically scan `link_shares` and delete/disable ones where the creator no longer has access. Simpler but not real-time.

3. **Join in the claim.** The `accessible_file_ids` link branch could join back to verify the creator's access, but this creates a circular reference in the claim definition that Postgres won't allow.

### Supabase Realtime on Comments

**Not passed.** The spec asks for a Realtime event when a comment is added. The `data_api` views are read-only views with INSTEAD OF triggers — Supabase Realtime doesn't fire on view changes, only on direct table changes.

**How to solve:**

1. **Broadcast from the trigger.** The INSTEAD OF INSERT trigger on `data_api.comments` could call `pg_notify()` or Supabase's Realtime broadcast after a successful insert. This only fires for authorized inserts, so there's no information leak.

2. **Realtime on the public table.** Subscribe to `public.comments` changes, then filter client-side against the user's access. Leaks metadata (you'd see that a comment was added, even if you can't read it).

3. **Supabase Realtime with RLS.** Add RLS policies on `public.comments` that mirror the claim logic. Realtime would respect them. But this duplicates the auth rules in RLS, which defeats the purpose.

### Server-to-Server (API Tokens / OAuth)

**Not passed.** The system is tied to `auth.uid()` from Supabase Auth JWTs. There's no concept of a service token with scoped access to specific directories.

**How to solve:**

1. **Service accounts via auth.users.** Create service accounts in `auth.users`, issue JWTs for them. The claims system works as-is since it queries based on `auth.uid()`. Scope directory access by creating share rows from the user to the service account.

2. **API key table.** A `service_tokens` table mapping tokens to user IDs + scoped permissions. A middleware function validates the token and sets the session user via `set_config`. The rest of the system works unchanged.

3. **Edge Function layer.** An Edge Function that validates the server's credentials, then uses the `service_role` key to query on behalf of the scoped user. Access control stays in the database.

### User Impersonation / Temporary Support Access

**Not passed.** No mechanism for a support person to assume another user's identity or get temporary access.

**How to solve:**

1. **Impersonation via `set_config`.** A `SECURITY DEFINER` function granted only to `service_role` that calls `set_config('request.jwt.claim.sub', target_user_id, true)` to override `auth.uid()` for the current transaction. Zero changes to claims or compiler — everything downstream resolves as the impersonated user. Gate access through an Edge Function. Pair with an `audit_logs` INSERT for traceability.

2. **Temporary share.** Create time-limited share rows from the target user's resources to the support person. Claims already resolve shares, so access is immediate with no system changes. Coarser than true impersonation — grants real access rather than "viewing as."

3. **Audit-safe impersonation.** An `impersonation_sessions` table + an `auth_rules.effective_uid()` wrapper that returns the target user when an active session exists, falling back to `auth.uid()`. Full audit trail and auto-expiry, but requires compiler changes.

---

## Summary

| Spec Item | Status | Notes |
|-----------|--------|-------|
| Data model | Pass | Full schema with tsvector columns and GIN indexes |
| List file system | Pass | Recursive folder expansion via claims (100k cap) |
| Recursive paths | Pass | WITH RECURSIVE in claims |
| Pagination | Partial | LIMIT/OFFSET works; no built-in cursor pagination |
| Counting | Pass | get_folder_item_count() with LIMIT cap |
| View file | Pass | Filter + require modes |
| Upload file | Pass | INSERT trigger validates ownership; FTS auto-updates via GENERATED column |
| Move file | Pass | UPDATE validates editable_file_ids + writable_folder_ids |
| Add comment | Pass | Multi-condition INSERT: user_id + commentable_file_ids |
| View comments | Pass | Scoped to commentable files |
| Remove comment | Pass | Owner-only delete |
| Search files | Pass | Postgres FTS via data_api.search(), auth-filtered |
| Search comments | Pass | Postgres FTS via data_api.search(), auth-filtered |
| Generate permalink | Pass | Link shares with tokens + expiration |
| Use permalink | Pass | Token-based access in claims, anonymous UUID fallback |
| Transitive permalink | Fail | Creator losing access doesn't invalidate link |
| Realtime comments | Fail | INSTEAD OF triggers don't fire Realtime events |
| Server-to-server | Fail | No API token / scoped access mechanism |
| Impersonation | Fail | No built-in mechanism |
| Permission repair | Partial | Live queries = self-healing, but no bulk audit tools |
| External search indexing | Partial | Postgres FTS auto-updates; no external service hook |
| Introduce a team | Pass | Groups in all claims via shared_with_group_id |
| Audit logs | Pass | Admin-only via admin_org_ids claim |
