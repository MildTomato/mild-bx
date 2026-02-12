# Auth Rules: Dropbox Spec Evaluation

## At a Glance

**Pass:**
- [Data model](#data-model)
- [List file system](#list-file-system)
- [Recursive paths](#list-file-system)
- [Counting](#list-file-system)
- [View file](#view-file)
- [Upload file](#upload-file)
- [Add comment](#add-comment-to-file)
- [View comments](#view-file-comments)
- [Remove comment](#remove-file-comment)
- [Generate permalink](#generate-permalink)
- [Use permalink](#use-permalink)
- [Introduce a team](#introduce-a-team-groups)
- [Audit logs](#audit-logs)

**Partial:**
- [Pagination](#list-file-system)
- [Move file](#move-file-to-another-location)
- [Permission repair](#re-assign-permissions-after-a-bug)

**Fail:**
- [Transitive permalink](#transitive-permalink-access)
- [Search files](#search-through-files-full-text)
- [Search comments](#search-through-comments-full-text)
- [Realtime comments](#supabase-realtime-on-comments)
- [Server-to-server](#server-to-server-api-tokens--oauth)
- [Impersonation](#user-impersonation--temporary-support-access)
- [External search indexing](#upload-file--external-search-indexing)

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

Fully implemented. The example app has: `files`, `folders`, `shares`, `link_shares`, `comments`, `organizations`, `org_members`, `groups`, `group_members`, `audit_logs`, and a `users` view over `auth.users`.

### List File System

**Passed.** The `data_api.files` and `data_api.folders` views filter to rows the user can access. A client query is just:

```ts
const { data } = await supabase.from('folders').select('*').schema('data_api')
```

The `accessible_folder_ids` claim uses recursive CTEs with LATERAL joins to expand shared folder hierarchies, so sharing a parent folder automatically grants access to all subfolders.

**Supports recursive paths?** Yes. The claims use `WITH RECURSIVE folder_tree` to expand folder hierarchies. Sharing a folder at any level grants access to everything underneath it.

**Supports pagination?** Partially. The views are standard Postgres views, so the client can use `.range()` or `LIMIT/OFFSET`. But there's no built-in cursor-based pagination or keyset pagination in the system itself.

**Supports counting?** Yes. `data_api.get_folder_item_count(folder_id)` counts files and subfolders recursively, with a configurable LIMIT cap (default 5001) to prevent expensive queries on huge folders.

### View File

**Passed.** The `data_api.files` view includes the `content` column. Filter mode returns nothing if the user can't access it. Require mode (`select_strict`) raises an error.

### Upload File

**Passed.** INSERT rule on files validates `owner_id = auth.uid()`. The trigger function validates this and inserts into the public table.

```sql
SELECT auth_rules.rule('files',
  auth_rules.insert(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker())
);
```

### Add Comment to File

**Passed.** INSERT rule on comments validates both `user_id = auth.uid()` AND `file_id` is in the user's `commentable_file_ids` claim (files with comment or edit permission).

### View File Comments

**Passed.** SELECT rule on comments filters by `commentable_file_ids`. Users see comments on files they have comment or edit access to.

### Remove File Comment

**Passed.** DELETE rule validates `user_id = auth.uid()` — users can only delete their own comments.

### Generate Permalink

**Passed.** Link shares have INSERT/DELETE rules scoped to `created_by = auth.uid()`. A user creates a link share row with a unique token, resource reference, and permission level.

### Use Permalink

**Passed.** The `accessible_file_ids` claim includes a union branch that checks `current_link_token()` against `link_shares.token`, respecting `expires_at`. Anonymous users get a fixed UUID so the claim system works without a real `auth.uid()`.

### Introduce a Team (Groups)

**Passed.** Groups already exist. The `accessible_file_ids`, `editable_file_ids`, `commentable_file_ids`, and `accessible_folder_ids` claims all include branches for group-based sharing (`shares.shared_with_group_id` joined to `group_members`).

### Audit Logs

**Passed.** SELECT rule on audit_logs is scoped to `admin_org_ids` — only org admins can see logs for their org.

---

## What We Don't Pass

### Move File to Another Location

**Partially passed.** The compiler now validates NEW values on UPDATE — the same pattern INSERT already uses. This means UPDATE triggers can enforce that the destination `folder_id` is in the user's writable set.

The pattern works like this:

```sql
-- Claim: which folders can this user write to?
SELECT auth_rules.claim('writable_folder_ids', $$
  SELECT owner_id AS user_id, id AS folder_id FROM folders
$$);

-- Rule: update requires ownership + destination folder access
SELECT auth_rules.rule('movable_files',
  auth_rules.update(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker()),
  auth_rules.eq('folder_id', auth_rules.one_of('writable_folder_ids'))
);
```

The generated UPDATE trigger validates:
1. `OLD.owner_id = auth.uid()` (user owns the file)
2. `NEW.owner_id = auth.uid()` (can't transfer ownership)
3. `NEW.folder_id` is in `writable_folder_ids` (destination folder is authorized)

**What's missing for full pass:** The example app's files UPDATE rule only checks `editable_file_ids` — it doesn't include a `folder_id` condition yet. Adding a `writable_folder_ids` claim and a second condition to the files UPDATE rule would complete this. The system supports it, the app just needs to use it.

### Transitive Permalink Access

**Not passed.** The spec says: "if the user who created the permalink loses access, the link should also become invalid." Our link shares are independent rows — they don't track whether the creator still has access. A user could create a link, lose access to the file, and the link would still work.

**How to solve:**

1. **Join in the claim.** The `accessible_file_ids` link branch could join back to `accessible_file_ids` for the link creator:
   ```sql
   SELECT ... FROM link_shares ls
   WHERE ls.token = current_link_token()
     AND EXISTS (
       SELECT 1 FROM accessible_file_ids
       WHERE user_id = ls.created_by AND id = ls.resource_id
     )
   ```
   This checks that the creator still has access. But it creates a circular reference in the claim definition that Postgres won't allow.

2. **Separate validation function.** A `validate_link_share()` function that checks creator access before returning the resource. Called from the claim or from a wrapper function.

3. **Background job.** Periodically scan link_shares and delete/disable ones where the creator no longer has access. Simpler but not real-time.

### Search Through Files (Full-Text)

**Not passed.** The spec asks for full-text search on file contents, with results filtered by access. We have the `content` column but no `tsvector` column, no GIN index, and no search function.

**How to solve:**

1. **Postgres FTS:** Add a `content_tsv tsvector` column to `files`, a GIN index, and a trigger to keep it updated. Then query through the `data_api.files` view with `to_tsquery()` — the access filtering happens automatically because the view already filters to accessible rows:
   ```ts
   supabase.from('files').select('*').schema('data_api')
     .textSearch('content_tsv', 'search terms')
   ```

2. **External search (ElasticSearch/Typesense):** Index file contents externally. At query time, get matching file IDs from the search service, then filter through `data_api.files` to enforce access:
   ```ts
   const searchIds = await elasticsearch.search('search terms')
   supabase.from('files').select('*').schema('data_api')
     .in('id', searchIds)
   ```
   The view automatically strips out any IDs the user can't access.

### Search Through Comments (Full-Text)

**Not passed.** Same situation as files — no FTS setup on comments.

**How to solve:** Same approaches as above. Add `content_tsv` to comments, or use external search. The `data_api.comments` view already filters by `commentable_file_ids`, so access control is automatic.

### Supabase Realtime on Comments

**Not passed.** The spec asks for a Realtime event when a comment is added. The data_api views are read-only views with INSTEAD OF triggers — Realtime doesn't fire on views.

**How to solve:**

1. **Realtime on the public table.** Subscribe to `public.comments` changes, then filter client-side against the user's access. Leaks metadata (you'd see that a comment was added, even if you can't read it).

2. **Broadcast from the trigger.** The INSERT trigger on `data_api.comments` could call `pg_notify()` or Supabase's Realtime broadcast after a successful insert. This only fires for authorized inserts.

3. **Supabase Realtime with RLS.** If we add RLS policies on `public.comments` that mirror the claim logic, Realtime would respect them. But this duplicates the auth rules in RLS, which defeats the purpose.

### Server-to-Server (API Tokens / OAuth)

**Not passed.** The system is tied to `auth.uid()` from Supabase Auth JWTs. There's no concept of a service token with scoped access to specific directories.

**How to solve:**

1. **Custom JWT claims.** Create service accounts in `auth.users`, issue JWTs with custom claims that encode which directories the server can access. The claims system would work as-is since it queries based on `auth.uid()`.

2. **API key table.** A `service_tokens` table mapping tokens to user IDs + scoped permissions. A middleware function validates the token and sets `auth.uid()` via `set_config`. The rest of the system works unchanged.

3. **Edge function layer.** An Edge Function that validates the server's credentials, then uses the `service_role` key to query on behalf of the scoped user. The access control stays in the database.

### User Impersonation / Temporary Support Access

**Not passed.** No mechanism for a support person to assume another user's identity or get temporary access.

**How to solve:**

1. **Impersonation via `set_config` (recommended).** A `SECURITY DEFINER` function granted only to `service_role` that calls `set_config('request.jwt.claim.sub', target_user_id, true)` to override `auth.uid()` for the current transaction. Zero changes to claims or compiler — everything downstream resolves as the impersonated user. Gate access through an Edge Function. Pair with an `audit_logs` INSERT for traceability.

2. **Temporary share.** Create time-limited share rows from the target user's resources to the support person. Claims already resolve shares, so access is immediate with no system changes. Coarser than true impersonation — grants real access rather than "viewing as."

3. **Audit-safe impersonation.** An `impersonation_sessions` table + an `auth_rules.effective_uid()` wrapper that returns the target user when an active session exists, falling back to `auth.uid()`. Compiler emits `effective_uid()` instead of `auth.uid()`. Full audit trail and auto-expiry, but requires changes to `02-dsl.sql` and `03-compiler.sql`.

### Re-assign Permissions After a Bug

**Partially passed.** Because claims are live queries over the actual data (shares, org_members, etc.), fixing the data automatically fixes the permissions. There's no stale permission cache to invalidate. If a bug caused files to be moved incorrectly, fixing the `folder_id` values immediately restores correct access.

However, there's no built-in tooling for bulk permission auditing or repair — you'd write SQL directly against the shares/org_members tables.

### Upload File + External Search Indexing

**Not passed.** The spec asks that uploaded file content gets added to both Postgres FTS and an external search service. The INSERT trigger just inserts the row. There's no hook for indexing.

**How to solve:**

1. **Database trigger.** A AFTER INSERT trigger on `public.files` that updates the `content_tsv` column (for Postgres FTS) and calls `pg_notify()` or `net.http_post()` (via pg_net) to index in the external service.

2. **Supabase Database Webhooks.** Configure a webhook on `public.files` INSERT that calls an Edge Function to index the content externally.

3. **Edge Function wrapper.** Instead of inserting through `data_api.files` directly, call an Edge Function that does the insert + indexing in one step.

---

## Summary

| Spec Item | Status | Notes |
|-----------|--------|-------|
| Data model | Pass | |
| List file system | Pass | Recursive folder expansion via claims |
| Recursive paths | Pass | WITH RECURSIVE in claims |
| Pagination | Partial | Standard LIMIT/OFFSET works, no built-in cursors |
| Counting | Pass | get_folder_item_count() |
| View file | Pass | Filter + require modes |
| Upload file | Pass | INSERT trigger validates ownership |
| Move file | Partial | UPDATE validates NEW values; example app needs writable_folder_ids claim |
| Add comment | Pass | Multi-condition INSERT validation |
| View comments | Pass | Scoped to commentable files |
| Remove comment | Pass | Owner-only delete |
| Search files | Fail | No FTS setup |
| Search comments | Fail | No FTS setup |
| Generate permalink | Pass | Link shares with tokens |
| Use permalink | Pass | Token-based access in claims |
| Transitive permalink | Fail | Creator losing access doesn't invalidate link |
| Realtime comments | Fail | Views don't fire Realtime events |
| Server-to-server | Fail | No API token / scoped access mechanism |
| Impersonation | Fail | No built-in mechanism |
| Permission repair | Partial | Live queries = self-healing, but no audit tools |
| External search indexing | Fail | No hook for indexing on upload |
| Introduce a team | Pass | Groups already implemented |
