id: auth-permissions
category: Auth & permissions
title: Two roles, permissions per domain
kicker: Auth & permissions
---
Authentication is a single bearer key per user; authorization is granted per domain, not per key or per record.

1. **Two roles.** `Admin` bypasses all permission checks — full read+write on every domain, plus the ability to manage users, permissions, and domains. `User` can only do what's explicitly granted.
2. **Permissions are `read` < `write` < `ddl`, per domain.** Each level includes the ones below it. `write` covers ordinary reads and writes; `ddl` — schema-changing LuraSQL — only matters for `rel` domains.
3. **Grants are per engine, not just per domain name.** A `shop` grant in `kv` says nothing about `shop` in `json` or `rel` — same story as the domains themselves (see [domains & isolation](docs:domains-isolation)).
4. **A key is shown exactly once.** `POST /auth/users` and `POST /auth/users/{name}/rotate-key` return the plaintext key in that one response; afterwards the server only ever stores its hash. Rotating invalidates the old key immediately.
5. **Admins live in `luradb.toml`, everyone else lives in the API.** `[[auth.admins]]` entries are reconciled at server startup — adding or removing one needs a restart. Regular users and their per-domain permissions are managed live over `POST`/`DELETE /store-api/auth/users…`, no restart required.

## Example

```
POST /store-api/auth/users
{ "name": "alice" }

→ 201 { "name": "alice", "role": "User", "api_key": "lura_ab12…9f" }

POST /store-api/auth/users/alice/permissions
{ "domain": "shop", "access": "write" }

→ 200
```

---
related: domains-isolation | Domains & isolation
related: errors-status-codes | 401 vs 403
