# Syntax Comparison: DSL vs SQL vs RLS

Side-by-side comparison of TypeScript DSL, proposed SQL syntax, and RLS.

---

## Example 1: Simple User Ownership

**TypeScript DSL:**

```ts
export const messages = createAuthRule((db, ctx) =>
  db
    .from('messages')
    .select(['id', 'content', 'user_id', 'created_at'])
    .eq('user_id', ctx.auth.userId())
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.select('id', 'content', 'user_id', 'created_at'),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**RLS:**

```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON messages
FOR SELECT USING (user_id = auth.uid());
```

**Differences:**

| Aspect           | DSL                            | Proposed SQL                   | RLS                                         |
| ---------------- | ------------------------------ | ------------------------------ | ------------------------------------------- |
| Column security  | Only specified columns exposed | Only specified columns exposed | No column restriction - all columns visible |
| Explicit filters | Required in client query       | Required in client query       | Implicit - client doesn't need filter       |

---

## Example 2: Org Membership with oneOf

**TypeScript DSL:**

```ts
export const projects = createAuthRule((db, ctx) =>
  db
    .from('projects')
    .select(['id', 'name', 'org_id', 'created_at'])
    .eq('org_id', oneOf(ctx.org_ids))
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('projects',
  auth_rules.select('id', 'name', 'org_id', 'created_at'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**RLS:**

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON projects
FOR SELECT USING (
  org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )
);
```

**Differences:**

| Aspect             | DSL                                                 | Proposed SQL                                        | RLS                                                   |
| ------------------ | --------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Column security    | Only specified columns exposed                      | Only specified columns exposed                      | All columns visible                                   |
| Filter requirement | Client must provide `.eq('org_id', 'specific-org')` | Client must provide `.eq('org_id', 'specific-org')` | Client can query without filter - gets all their orgs |
| Query behavior     | Single org per query                                | Single org per query                                | All accessible orgs in one query                      |

---

## Example 3: Multiple Filters

**TypeScript DSL:**

```ts
export const messages = createAuthRule((db, ctx) =>
  db
    .from('messages')
    .select(['id', 'content', 'org_id', 'user_id'])
    .eq('org_id', oneOf(ctx.org_ids))
    .eq('user_id', ctx.auth.userId())
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.select('id', 'content', 'org_id', 'user_id'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**RLS:**

```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON messages
FOR SELECT USING (
  user_id = auth.uid()
  AND org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )
);
```

**Differences:**

| Aspect                  | DSL                              | Proposed SQL                     | RLS                                      |
| ----------------------- | -------------------------------- | -------------------------------- | ---------------------------------------- |
| Column security         | Only specified columns exposed   | Only specified columns exposed   | All columns visible                      |
| Filter requirement      | Client must provide both filters | Client must provide both filters | Implicit - no filters needed             |
| Error on missing filter | Yes - explicit 403               | Yes - explicit 403               | No error - just returns filtered results |

---

## Example 4: Role-Based Access with checkClaim

**TypeScript DSL:**

```ts
export const billing = createAuthRule((db, ctx) =>
  db
    .from('org_billing')
    .select(['id', 'org_id', 'plan', 'amount'])
    .in('org_id', ctx.org_ids, checkClaim('org_roles', { role: ['admin', 'owner'] }))
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('org_billing',
  auth_rules.select('id', 'org_id', 'plan', 'amount'),
  auth_rules.in('org_id', 'org_ids', auth_rules.check('org_roles', 'role', ARRAY['admin', 'owner']))
);
```

**RLS:**

```sql
ALTER TABLE org_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_select" ON org_billing
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM org_members
    WHERE org_members.org_id = org_billing.org_id
      AND org_members.user_id = auth.uid()
      AND org_members.role IN ('admin', 'owner')
  )
);
```

**Differences:**

| Aspect          | DSL                                     | Proposed SQL                            | RLS                            |
| --------------- | --------------------------------------- | --------------------------------------- | ------------------------------ |
| Column security | Only specified columns exposed          | Only specified columns exposed          | All columns visible            |
| Role check      | Explicit via checkClaim                 | Explicit via auth_rules.check                 | Embedded in policy subquery    |
| Error behavior  | 403 if user is member but wrong role    | 403 if user is member but wrong role    | Silent - just no rows returned |
| Debugging       | Clear error: "role must be admin/owner" | Clear error: "role must be admin/owner" | Empty result - unclear why     |

---

## Example 5: Insert Operation

**TypeScript DSL:**

```ts
export const messagesInsert = createAuthRule((db, ctx) =>
  db.from('messages').insert().eq('user_id', ctx.auth.userId()).eq('org_id', oneOf(ctx.org_ids))
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.insert(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**RLS:**

```sql
CREATE POLICY "messages_insert" ON messages
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )
);
```

**Differences:**

| Aspect        | DSL                                     | Proposed SQL                            | RLS                                |
| ------------- | --------------------------------------- | --------------------------------------- | ---------------------------------- |
| Validation    | Checks payload values match claims      | Checks payload values match claims      | Checks payload values match policy |
| Error message | "user_id must match authenticated user" | "user_id must match authenticated user" | Generic policy violation error     |

---

## Example 6: Update Operation

**TypeScript DSL:**

```ts
export const messagesUpdate = createAuthRule((db, ctx) =>
  db.from('messages').update().eq('user_id', ctx.auth.userId()).eq('org_id', oneOf(ctx.org_ids))
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.update(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**RLS:**

```sql
CREATE POLICY "messages_update" ON messages
FOR UPDATE USING (
  user_id = auth.uid()
  AND org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )
);
```

**Differences:**

| Aspect             | DSL                                  | Proposed SQL                         | RLS                                     |
| ------------------ | ------------------------------------ | ------------------------------------ | --------------------------------------- |
| Filter requirement | Client must include filters in WHERE | Client must include filters in WHERE | Implicit - policy filters automatically |

---

## Example 7: Delete Operation

**TypeScript DSL:**

```ts
export const messagesDelete = createAuthRule((db, ctx) =>
  db.from('messages').delete().eq('user_id', ctx.auth.userId()).eq('org_id', oneOf(ctx.org_ids))
)
```

**Proposed SQL:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.delete(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**RLS:**

```sql
CREATE POLICY "messages_delete" ON messages
FOR DELETE USING (
  user_id = auth.uid()
  AND org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )
);
```

---

## Summary: Key Differences

| Feature                        | DSL / Proposed SQL                | RLS                              |
| ------------------------------ | --------------------------------- | -------------------------------- |
| **Column security**            | Built-in via select()             | Not supported - need views       |
| **Explicit filters**           | Required from client              | Implicit - applied automatically |
| **Error messages**             | Specific: "missing org_id filter" | Generic: "policy violation"      |
| **Debugging**                  | Clear rejection reasons           | Silent filtering, empty results  |
| **Query pattern**              | Client specifies exact scope      | Client can query broadly         |
| **Performance predictability** | Client controls query scope       | Hidden subqueries on every query |
