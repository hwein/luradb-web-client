id: backup-restore
category: Backup & restore
title: Export today, scheduled backup on the roadmap
kicker: Backup & restore
---
LuraDB has no dedicated backup system running today. What exists is a plain export endpoint for the JSON engine, plus a fully designed but not-yet-built backup/restore feature.

1. **One export endpoint exists today.** `GET /store-api/json/{domain}/export` streams every document of that JSON domain as NDJSON — one JSON object per line, without buffering the whole domain in memory.
2. **Nothing else is exposed yet.** No KV export, no REL export, and no matching import/restore endpoint for the JSON export either.
3. **A real backup/restore feature is designed but not built.** A logical, NDJSON-based backup covering all engines — scoped to everything, one engine, or one domain, run on a schedule or on demand, downloadable and restorable over REST — is a ready-to-implement spec on the server roadmap. It is not running on any server yet.
4. **Until then, "backup" means exporting yourself.** Pull the JSON export regularly and keep the file somewhere safe; there is no server-side scheduling or retention to rely on.

## Example

```
GET /store-api/json/shop/export

→ 200
{"_key":"cus_8102","_version":1,"name":"M. Keller","city":"Essen"}
{"_key":"cus_8103","_version":1,"name":"A. Roth","city":"Bochum"}
```

---
related: json-documents-indexes | JSON documents & indexes
related: domains-isolation | Domains & isolation
