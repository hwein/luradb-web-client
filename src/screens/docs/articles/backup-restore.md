id: backup-restore
category: Backup & restore
title: Scoped NDJSON backups, restored over REST
kicker: Backup & restore
---
Since LuraDB 0.3.0 the server ships a logical backup/restore feature: NDJSON archives covering the KV and JSON engines, created on demand or on a schedule, downloadable, uploadable and restorable over REST. It is **opt-in** — set `backup.enabled = true` in `luradb.toml` and restart; while it is off every route answers `503`. All routes are admin-only.

1. **List and create.** `GET /store-api/backups` returns the finished archives plus the currently running job separately in `running`. `POST /store-api/backups` with `{"scope": "all"}` starts an on-demand job and answers `202` with the new id.
2. **Scopes.** `all`, `kv`, `json`, `kv:<domain>`, `json:<domain>` or `domain:<name>`. `include_auth` adds the auth users and permissions, and only counts for the plain `all`/`kv` scopes. Relational data is never part of an archive.
3. **Download and upload.** `GET /store-api/backups/{id}/download` streams the archive as `application/x-ndjson` (range requests supported); `POST /store-api/backups/upload` takes a raw archive file as the request body and registers it on the server. `DELETE /store-api/backups/{id}` removes one.
4. **Restore is asynchronous.** `POST /store-api/backups/{id}/restore` accepts `mode` (`fail_if_exists` by default, or `replace`), `into_domain` for single-domain archives and `include_auth`; it answers `202` with a `restore_id`. Poll `GET /store-api/restores/{id}` for `imported`/`skipped`/`failed` and the error list — that status lives in memory only and is gone after a server restart.
5. **One job at a time.** Backup and restore share a single slot: a second job gets `409 backup_busy`. Uploads do not take the slot. Errors that only surface while restoring (an existing target domain, a checksum mismatch) appear in the restore status, not as an HTTP error of the `POST`.

## Example

```
POST /store-api/backups/bk_20260826T020000Z_all/restore
{"mode": "replace", "include_auth": true}

→ 202 {"restore_id": "rst_41c9", "state": "running"}

GET /store-api/restores/rst_41c9
→ 200 {"state": "complete", "imported": 8102, "skipped": 0, "failed": 0, "errors": []}
```
---
related: domains-isolation | Domains & isolation
related: auth-permissions | Auth & permissions
