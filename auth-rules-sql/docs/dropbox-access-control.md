# Dropbox-Style Access Control Features

This document outlines access control patterns found in Dropbox-like file storage systems. Use these as test cases for the auth_rules system.

## 1. Ownership

**Personal files**: A user owns files they create.
- User can CRUD their own files
- Other users cannot see/access personal files by default

**Transfer ownership**: Files can be transferred to another user.
- Original owner loses access after transfer
- New owner gains full control

## 2. Sharing

### Direct sharing (user-to-user)
- Owner shares file/folder with specific user
- Permission levels: `view`, `comment`, `edit`
- Shared user can only perform allowed actions
- Owner can revoke access

### Link sharing
- Generate shareable link for a file/folder
- Link types:
  - `public` - anyone with link can access
  - `password` - requires password
  - `expiring` - link expires after date/time
  - `domain_restricted` - only users from specific email domain
- Link permission: `view` or `edit`

### Group sharing
- Share with a group instead of individual users
- All group members get access
- Adding/removing group members updates access automatically

## 3. Folders & Hierarchy

**Folder permissions inherit to children**:
- File inside shared folder inherits folder's permissions
- Can override: make file more restrictive than parent
- Cannot override: make file less restrictive than parent (security)

**Nested folders**:
- `/team/project/docs/secret.pdf`
- Access to `secret.pdf` requires access to all parent folders
- OR: Access granted at any level grants access to that item

## 4. Teams / Organizations

**Organization membership**:
- Users belong to one or more organizations
- Org admins can manage members

**Team folders**:
- Shared spaces for the whole organization
- All org members have access (configurable level)

**Team groups**:
- Subsets of org members (e.g., "Engineering", "Marketing")
- Share content with specific groups within org

**Roles within org**:
- `member` - basic access
- `admin` - manage members, settings
- `owner` - full control, billing, delete org

## 5. Admin Capabilities

**Audit logs**: Only admins can view activity logs
**Member management**: Only admins can add/remove org members
**Settings**: Only admins can change org settings
**Storage quotas**: Admins can view/manage storage usage
**Compliance**: Admins can place legal holds on files

## 6. External Sharing

**Share outside org**:
- Share files with users not in your organization
- Org policy can allow/deny external sharing
- External users have limited permissions

**Guest access**:
- External user can be invited as "guest" to org
- Guests have restricted access to specific folders only

## 7. Access Conditions

**Time-based**:
- Access only during certain hours
- Access expires after date

**Location-based**:
- Access only from certain IP ranges
- Access only from certain countries

**Device-based**:
- Access only from approved devices
- Access only from managed devices

## 8. Delegated Access

**On behalf of**:
- Admin can act on behalf of user (support)
- Audit trail shows who did what

**Service accounts**:
- Non-human accounts for integrations
- Scoped permissions

---

## Test Scenarios to Implement

### Basic Ownership
1. User can see their own files
2. User cannot see other users' files
3. User can create files (owned by them)
4. User can delete their own files
5. User cannot delete other users' files

### Direct Sharing
6. Owner shares file with user (view) - user can read
7. Owner shares file with user (view) - user cannot edit
8. Owner shares file with user (edit) - user can edit
9. Owner revokes access - user can no longer see file
10. Non-owner cannot share file

### Permission Levels
11. Viewer can read, cannot edit/delete
12. Commenter can read and comment, cannot edit
13. Editor can read and edit, cannot delete
14. Owner can read, edit, delete, share

### Folder Hierarchy
15. User with folder access can see files inside
16. User without folder access cannot see files inside
17. Nested folder: access to parent grants access to children
18. Nested folder: no access to parent blocks access to children

### Groups
19. Share with group - all members can access
20. Add user to group - user gains access
21. Remove user from group - user loses access
22. Delete group - all members lose access

### Organizations
23. Org member can see org team folders
24. Non-member cannot see org team folders
25. Org admin can see audit logs
26. Org member (non-admin) cannot see audit logs
27. Org admin can add members
28. Org member cannot add members

### Link Sharing
29. Public link - anyone can access
30. Public link - anonymous (no auth) can access
31. Password link - wrong password denied
32. Password link - correct password allowed
33. Expiring link - valid before expiry
34. Expiring link - denied after expiry

### External Sharing
35. Share with external user - external can access
36. Org blocks external sharing - share denied
37. Guest user can only see allowed folders

### Edge Cases
38. User in multiple orgs - sees files from both
39. User with no orgs - sees only personal files
40. File shared via multiple paths - still works
41. Circular group membership - doesn't break
42. Delete user - their files handled correctly
43. Delete org - all org content handled correctly
