# Scalability Considerations

Analysis of performance characteristics and best practices for the auth rules system at scale.

## Key Insight: WHERE Filters First

The most important thing to understand: **PostgreSQL applies indexed filters before evaluating functions**.

```sql
-- User queries:
SELECT * FROM data_api.files WHERE folder_id = 'xyz';

-- View definition:
SELECT * FROM files WHERE auth_rules.require('accessible_file_ids', 'id', id);

-- Combined (what actually runs):
SELECT * FROM files
WHERE auth_rules.require('accessible_file_ids', 'id', id)
  AND folder_id = 'xyz';
```

With an index on `folder_id`, PostgreSQL:
1. Uses index to find rows where `folder_id = 'xyz'` (say, 100 rows)
2. Evaluates `require()` only for those 100 rows
3. NOT for all 5 million rows in the table

**This means require() per row is fine for normal queries.**

The "5 million require() calls" scenario only happens with unfiltered queries like `SELECT * FROM data_api.files` - which is a bad query anyway (nobody wants 5M rows returned).

## Best Practice: Put require() Last in WHERE

Structure views so that cheap/indexed conditions come first:

```sql
-- Good: indexed checks first, require() last
CREATE VIEW data_api.files AS
SELECT * FROM files f
WHERE f.folder_id IN (SELECT id FROM accessible_folder_ids WHERE user_id = auth.uid())
  AND f.owner_id = auth.uid()
  AND auth_rules.require('accessible_file_ids', 'id', f.id);

-- Less optimal: require() first
CREATE VIEW data_api.files AS
SELECT * FROM files f
WHERE auth_rules.require('accessible_file_ids', 'id', f.id)
  AND f.folder_id IN (...);
```

While PostgreSQL's optimizer doesn't guarantee evaluation order, putting `require()` last is good practice and can hint to the planner.

## Folder-Based Permissions (Recommended)

Like Dropbox, use folder-level permissions as the primary model:

**Why this scales:**
- Users have access to ~50 folders (small set)
- Each folder contains thousands of files
- Check folder access once, not per file

**Claims become small:**
```sql
-- Small: user's accessible folders
accessible_folder_ids = owned folders + shared folders (~50 rows per user)

-- Small: explicit file shares (rare)
directly_shared_file_ids = individual file shares (~10 rows per user)
```

**View uses folder-based access:**
```sql
CREATE VIEW data_api.files AS
SELECT f.* FROM files f
WHERE
  -- Folder access (small set, indexed)
  f.folder_id IN (SELECT id FROM accessible_folder_ids WHERE user_id = auth.uid())
  -- Or direct ownership (indexed)
  OR f.owner_id = auth.uid()
  -- Or explicit file share (small set)
  OR f.id IN (SELECT id FROM directly_shared_file_ids WHERE user_id = auth.uid())
  -- Error if none match
  OR auth_rules.raise_error('file access denied');
```

## What Actually Needs Optimization

### 1. Ensure Proper Indexes

```sql
CREATE INDEX idx_files_folder ON files(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX idx_files_owner ON files(owner_id);
CREATE INDEX idx_shares_resource ON shares(resource_type, resource_id);
CREATE INDEX idx_shares_user ON shares(shared_with_user_id) WHERE shared_with_user_id IS NOT NULL;
CREATE INDEX idx_shares_group ON shares(shared_with_group_id) WHERE shared_with_group_id IS NOT NULL;
```

### 2. Skip Link Token Check When Authenticated

```sql
-- Instead of always checking link_shares:
WHERE (link_token_valid() OR user_has_access())

-- Check user first, skip link check if authenticated:
WHERE (auth.uid() IS NOT NULL AND user_has_access())
   OR (auth.uid() IS NULL AND link_token_valid())
```

### 3. Avoid Unfiltered Queries

Enforce filters in application layer or add safeguards:

```sql
-- View that requires a filter
CREATE VIEW data_api.files AS
SELECT * FROM files f
WHERE
  -- Must have folder_id or id filter, otherwise limit results
  CASE
    WHEN current_setting('app.has_filter', true)::boolean THEN true
    ELSE f.owner_id = auth.uid()  -- Fallback: only own files
  END
  AND auth_rules.require(...);
```

## Performance Characteristics

| Query Pattern | require() Calls | Performance |
|---------------|-----------------|-------------|
| `WHERE id = 'xyz'` | 1 | Instant |
| `WHERE folder_id = 'abc'` | ~100 (files in folder) | Fast |
| `WHERE owner_id = auth.uid()` | ~1000 (user's files) | Fast |
| No filter (bad query) | All rows | Slow - avoid this |

## Things That Don't Scale (and Mitigations)

### Deep Folder Hierarchies

Recursive permission inheritance is expensive:

```sql
-- This is slow:
WITH RECURSIVE folder_tree AS (...)
```

**Mitigation**: Limit folder depth, or use materialized path pattern.

### Users in Many Groups

Each group multiplies join complexity.

**Mitigation**: Limit groups per user, or denormalize group membership.

### "Show All Files I Can Access"

Fundamentally O(n) where n = accessible files.

**Mitigation**: Pagination, require folder filter, lazy loading.

## When to Consider Advanced Optimizations

| Scale | Approach |
|-------|----------|
| < 100K files | Current approach works fine |
| 100K - 1M files | Add indexes, use folder-based claims |
| 1M+ files | Consider materialized views for claims |
| 10M+ files | Denormalized access tables, caching layer |

## Materialized Claims (For Large Scale)

If claim computation becomes slow:

```sql
CREATE MATERIALIZED VIEW auth_rules_claims.accessible_folder_ids AS
SELECT user_id, folder_id FROM ...;

CREATE UNIQUE INDEX ON auth_rules_claims.accessible_folder_ids(user_id, folder_id);

-- Refresh on changes
CREATE TRIGGER refresh_accessible_folders
AFTER INSERT OR UPDATE OR DELETE ON shares
FOR EACH STATEMENT EXECUTE FUNCTION refresh_folder_claims();
```

## Summary

1. **require() per row is NOT the problem** - WHERE filters apply first via indexes
2. **Use folder-based permissions** - keeps claim sets small
3. **Put require() last** in WHERE clauses
4. **Add proper indexes** on filter columns
5. **Avoid unfiltered queries** - enforce filters in app layer
6. **Only optimize when needed** - current approach works for most use cases
