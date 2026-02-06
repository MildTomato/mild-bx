# Functions Approach

All data access goes through PostgreSQL functions. Functions validate inputs against claims before querying.

---

## How It Works

1. Customer defines rules (SQL syntax)
2. System generates functions for each table/action
3. Client calls functions (not tables directly)
4. Functions validate, then query
5. Client lib makes function calls feel like normal table access

---

## Example 1: Simple User Ownership

**Rule definition:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.select('id', 'content', 'user_id', 'created_at'),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.get_messages(
  p_user_id UUID
)
RETURNS TABLE (id UUID, content TEXT, user_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate: user_id must match authenticated user
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'user_id must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.content, m.user_id, m.created_at
  FROM internal.messages m
  WHERE m.user_id = p_user_id;
END;
$$;
```

**Client calls:**

```sql
-- Via PostgREST RPC
POST /rpc/get_messages
{ "p_user_id": "user-123" }
```

**Client lib abstracts it:**

```ts
// What developer writes (feels normal)
await client.from('messages').select('id, content, user_id, created_at').eq('user_id', userId)

// What actually happens (function call)
await client.rpc('get_messages', { p_user_id: userId })
```

---

## Example 2: Org Membership with one_of

**Rule definition:**

```sql
SELECT auth_rules.rule('projects',
  auth_rules.select('id', 'name', 'org_id', 'created_at'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.get_projects(
  p_org_id UUID
)
RETURNS TABLE (id UUID, name TEXT, org_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate: org_id must be in user's org_ids claim
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.org_id, p.created_at
  FROM internal.projects p
  WHERE p.org_id = p_org_id;
END;
$$;
```

**Client lib:**

```ts
// What developer writes
await client.from('projects').select('id, name, org_id, created_at').eq('org_id', orgId)

// What happens
await client.rpc('get_projects', { p_org_id: orgId })
```

---

## Example 3: Multiple Filters

**Rule definition:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.select('id', 'content', 'org_id', 'user_id'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.get_messages(
  p_org_id UUID,
  p_user_id UUID
)
RETURNS TABLE (id UUID, content TEXT, org_id UUID, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate: org_id must be in user's org_ids claim
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  -- Validate: user_id must match authenticated user
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'user_id must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.content, m.org_id, m.user_id
  FROM internal.messages m
  WHERE m.org_id = p_org_id AND m.user_id = p_user_id;
END;
$$;
```

---

## Example 4: Role-Based Access with check

**Rule definition:**

```sql
SELECT auth_rules.rule('org_billing',
  auth_rules.select('id', 'org_id', 'plan', 'amount'),
  auth_rules.in('org_id', 'org_ids', auth_rules.check('org_roles', 'role', ARRAY['admin', 'owner']))
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.get_org_billing(
  p_org_id UUID
)
RETURNS TABLE (id UUID, org_id UUID, plan TEXT, amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate: org_id must be in user's org_ids claim
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  -- Validate: user must have admin or owner role in this org
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_roles
    WHERE user_id = auth.uid()
      AND org_id = p_org_id
      AND role IN ('admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'requires admin or owner role'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.id, b.org_id, b.plan, b.amount
  FROM internal.org_billing b
  WHERE b.org_id = p_org_id;
END;
$$;
```

---

## Example 5: Insert

**Rule definition:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.insert(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.insert_message(
  p_org_id UUID,
  p_content TEXT
)
RETURNS internal.messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result internal.messages;
BEGIN
  -- Validate: org_id must be in user's org_ids claim
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO internal.messages (org_id, user_id, content)
  VALUES (p_org_id, auth.uid(), p_content)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
```

**Client lib:**

```ts
// What developer writes
await client.from('messages').insert({ org_id: orgId, content: 'Hello' })

// What happens
await client.rpc('insert_message', {
  p_org_id: orgId,
  p_content: 'Hello',
})
```

---

## Example 6: Update

**Rule definition:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.update(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.update_message(
  p_id UUID,
  p_org_id UUID,
  p_content TEXT
)
RETURNS internal.messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result internal.messages;
BEGIN
  -- Validate: org_id must be in user's org_ids claim
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  UPDATE internal.messages
  SET content = p_content
  WHERE id = p_id
    AND org_id = p_org_id
    AND user_id = auth.uid()
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;
```

---

## Example 7: Delete

**Rule definition:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.delete(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated function:**

```sql
CREATE FUNCTION data_api.delete_message(
  p_id UUID,
  p_org_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate: org_id must be in user's org_ids claim
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM internal.messages
  WHERE id = p_id
    AND org_id = p_org_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN TRUE;
END;
$$;
```

---

## Client Library Abstraction

The client lib translates familiar syntax to function calls:

| Developer writes                                                    | Becomes                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `.from('messages').select('*').eq('org_id', x)`                     | `rpc('get_messages', { p_org_id: x })`                       |
| `.from('messages').insert({ org_id, content })`                     | `rpc('insert_message', { p_org_id, p_content })`             |
| `.from('messages').update({ content }).eq('id', x).eq('org_id', y)` | `rpc('update_message', { p_id: x, p_org_id: y, p_content })` |
| `.from('messages').delete().eq('id', x).eq('org_id', y)`            | `rpc('delete_message', { p_id: x, p_org_id: y })`            |

Developer experience stays the same. Under the hood, it's all validated function calls.

---

## Benefits

1. **Explicit filter enforcement** - Function requires parameters, can't skip them
2. **Column security** - Function returns only specified columns
3. **Clear errors** - Function raises specific exceptions
4. **Validation before query** - Claims checked before any data access
5. **Standard PostgREST** - Just uses RPC, no modifications needed
6. **Type safety** - Function signature is typed

---

## Trade-offs

1. **Function per table/action** - More generated code
2. **Client lib changes** - Need to map `.from()` to `rpc()`
3. **Less flexible queries** - Can't do arbitrary filters beyond what rule allows
4. **Generated code maintenance** - Rules change = regenerate functions

---

## How Rules Generate Functions

When `auth_rules.rule()` is called:

1. Parse the rule definition
2. Extract: table, action, columns, required filters
3. Generate function with:
   - Parameters for each required filter
   - Validation for each filter against claims
   - Query with only specified columns
   - Appropriate return type
4. Create function in `api` schema (PostgREST exposed)
5. Store rule metadata for client lib to use

The client lib can fetch rule metadata to know how to map `.from()` calls to `rpc()` calls.
