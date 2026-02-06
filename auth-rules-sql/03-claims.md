# Claims

Claims are views that expose user relationships. They answer "which orgs does this user belong to?" and are used by rules to filter data.

---

## How Claims Work

1. Customer has membership tables (e.g., `public.org_members`)
2. System creates claims views (e.g., `auth_rules_claims.org_ids`)
3. Rules reference claims (e.g., `auth_rules.one_of('org_ids')`)
4. Generated views join to claims views for filtering

---

## Array Claims

Simple list of IDs the user has access to.

**Source table:**

```sql
-- Customer's existing table
CREATE TABLE public.org_members (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID NOT NULL
);
```

**Claims view:**

```sql
CREATE VIEW auth_rules_claims.org_ids AS
SELECT user_id, org_id
FROM public.org_members;
```

**Usage in rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'title', 'org_id'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated view uses it:**

```sql
CREATE VIEW data_api.documents AS
SELECT id, title, org_id
FROM public.documents
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid()
);
```

---

## Map Claims (with Role)

Claims that include additional properties like role.

**Source table:**

```sql
CREATE TABLE public.org_members (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  role TEXT NOT NULL  -- 'admin', 'member', 'viewer'
);
```

**Claims view:**

```sql
CREATE VIEW auth_rules_claims.org_roles AS
SELECT user_id, org_id, role
FROM public.org_members;
```

**Usage in rule with checkClaim:**

```sql
SELECT auth_rules.rule('org_billing',
  auth_rules.select('id', 'org_id', 'plan'),
  auth_rules.in('org_id', 'org_ids', auth_rules.check('org_roles', 'role', ARRAY['admin', 'owner']))
);
```

**Generated view uses role filter:**

```sql
CREATE VIEW data_api.org_billing AS
SELECT id, org_id, plan
FROM public.org_billing
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_roles
  WHERE user_id = auth.uid()
    AND role IN ('admin', 'owner')
);
```

---

## Common Claims Patterns

### Team membership

```sql
CREATE VIEW auth_rules_claims.team_ids AS
SELECT user_id, team_id
FROM public.team_members;
```

### Project access

```sql
CREATE VIEW auth_rules_claims.project_ids AS
SELECT user_id, project_id
FROM public.project_members;
```

### Hierarchical teams (recursive)

User in parent team gets access to child teams.

```sql
CREATE VIEW auth_rules_claims.accessible_team_ids AS
WITH RECURSIVE team_tree AS (
  -- Direct membership
  SELECT user_id, team_id
  FROM public.team_members

  UNION

  -- Child teams
  SELECT tt.user_id, t.id AS team_id
  FROM team_tree tt
  JOIN public.teams t ON t.parent_team_id = tt.team_id
)
SELECT DISTINCT user_id, team_id FROM team_tree;
```

### Time-based access

```sql
CREATE VIEW auth_rules_claims.active_course_ids AS
SELECT user_id, course_id
FROM public.enrollments
WHERE starts_at <= now() AND ends_at >= now();
```

### Multiple paths (direct + via team)

```sql
CREATE VIEW auth_rules_claims.all_org_ids AS
-- Direct org membership
SELECT user_id, org_id FROM public.org_members
UNION
-- Via team membership
SELECT tm.user_id, t.org_id
FROM public.team_members tm
JOIN public.teams t ON t.id = tm.team_id;
```

---

## Claims vs Rules

| Concept | Purpose                                               |
| ------- | ----------------------------------------------------- |
| Claims  | Define relationships (what does user have access to?) |
| Rules   | Define filters (what data can user see?)              |

Claims are reusable. Multiple rules can reference the same claim.

```sql
-- Same claim used by multiple rules
auth_rules.eq('org_id', auth_rules.one_of('org_ids'))  -- documents rule
auth_rules.eq('org_id', auth_rules.one_of('org_ids'))  -- projects rule
auth_rules.eq('org_id', auth_rules.one_of('org_ids'))  -- settings rule
```

---

## Performance

### Index source tables

```sql
CREATE INDEX idx_org_members_user ON public.org_members(user_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);
```

### Claims views are live

Claims views query source tables in real-time. When user is added to an org, they immediately have access. No cache invalidation needed.

### Large membership sets

User in 10,000 orgs? The subquery returns 10,000 rows. PostgreSQL handles this efficiently with proper indexes.

---

## Next: checkClaim()

For role-based filtering (only admins see billing), see [checkClaim()](./04-check-claim.md).
