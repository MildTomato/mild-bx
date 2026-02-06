# Basic Usage

Simple patterns for common authorization scenarios.

---

## Pattern 1: User Owns Their Data

**Scenario**: Users can only see their own profile.

**Rule:**

```sql
SELECT auth_rules.rule('profiles',
  auth_rules.select('id', 'user_id', 'bio', 'avatar_url'),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**Generated view:**

```sql
CREATE VIEW data_api.profiles AS
SELECT id, user_id, bio, avatar_url
FROM public.profiles
WHERE user_id = auth.uid();
```

**Client usage:**

```
GET /profiles
```

Returns only the authenticated user's profile.

---

## Pattern 2: Organization Membership

**Scenario**: Users can see documents in organizations they belong to.

**Claims view (system provides):**

```sql
CREATE VIEW auth_rules_claims.org_ids AS
SELECT user_id, org_id
FROM public.org_members;
```

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title', 'content'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated view:**

```sql
CREATE VIEW data_api.documents AS
SELECT id, org_id, title, content
FROM public.documents
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid()
);
```

**Client usage:**

```
GET /documents
GET /documents?org_id=eq.org-123
```

First returns all documents from all user's orgs. Second returns documents from specific org (if user is a member).

---

## Pattern 3: Teams in Orgs

**Scenario**: Users can see projects in teams they belong to.

**Claims view:**

```sql
CREATE VIEW auth_rules_claims.team_ids AS
SELECT user_id, team_id
FROM public.team_members;
```

**Rule:**

```sql
SELECT auth_rules.rule('projects',
  auth_rules.select('id', 'team_id', 'name', 'status'),
  auth_rules.eq('team_id', auth_rules.one_of('team_ids'))
);
```

**Generated view:**

```sql
CREATE VIEW data_api.projects AS
SELECT id, team_id, name, status
FROM public.projects
WHERE team_id IN (
  SELECT team_id FROM auth_rules_claims.team_ids WHERE user_id = auth.uid()
);
```

---

## Pattern 4: Insert

**Scenario**: Only org members can create documents in that org.

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.insert(),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('created_by', auth_rules.user_id())
);
```

**Generated trigger on view:**

```sql
CREATE FUNCTION data_api.documents_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate org_id
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this organization'
      USING ERRCODE = '42501';
  END IF;

  -- Validate created_by
  IF NEW.created_by != auth.uid() THEN
    RAISE EXCEPTION 'created_by must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.documents (org_id, title, content, created_by)
  VALUES (NEW.org_id, NEW.title, NEW.content, NEW.created_by);

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_insert
INSTEAD OF INSERT ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_insert_trigger();
```

**Client usage:**

```
POST /documents
{ "org_id": "org-123", "title": "My Doc", "content": "...", "created_by": "user-456" }
```

---

## Pattern 5: Update

**Scenario**: Users can only update their own documents.

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.update(),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('created_by', auth_rules.user_id())
);
```

**Generated trigger validates both conditions before allowing update.**

**Client usage:**

```
PATCH /documents?id=eq.doc-123
{ "title": "Updated Title" }
```

---

## Pattern 6: Delete

**Scenario**: Users can only delete documents they created.

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.delete(),
  auth_rules.eq('created_by', auth_rules.user_id())
);
```

**Generated trigger:**

```sql
CREATE FUNCTION data_api.documents_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.documents
  WHERE id = OLD.id
    AND created_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN OLD;
END;
$$;
```

**Client usage:**

```
DELETE /documents?id=eq.doc-123
```

---

## Pattern 7: Public + Private Data

**Scenario**: Some documents are public, others require membership.

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title', 'is_public'),
  auth_rules.or(
    auth_rules.eq('is_public', true),
    auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
  )
);
```

**Generated view:**

```sql
CREATE VIEW data_api.documents AS
SELECT id, org_id, title, is_public
FROM public.documents
WHERE is_public = TRUE
   OR org_id IN (SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid());
```

Unauthenticated users see only public documents.

---

## Quick Reference

| Scenario         | Rule                                                          |
| ---------------- | ------------------------------------------------------------- |
| User's own data  | `auth_rules.eq('user_id', auth_rules.user_id())`              |
| Org membership   | `auth_rules.eq('org_id', auth_rules.one_of('org_ids'))`       |
| Team membership  | `auth_rules.eq('team_id', auth_rules.one_of('team_ids'))`     |
| Role-based       | `auth_rules.in('org_id', 'org_ids', auth_rules.check(...))` |
| Public + private | `auth_rules.or(auth_rules.eq('is_public', true), ...)`        |

---

## Error Handling

Write triggers (INSERT/UPDATE/DELETE) raise meaningful errors:

```sql
RAISE EXCEPTION 'Not a member' USING ERRCODE = '42501';
RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
```

PostgREST translates to HTTP:

| ERRCODE | HTTP Status     |
| ------- | --------------- |
| `P0002` | 404 Not Found   |
| `42501` | 403 Forbidden   |
| `22023` | 400 Bad Request |

---

## Next: Claims

See [Claims](./03-claims.md) for how claims work in detail.
