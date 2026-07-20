id: domains-isolation
category: Domains & isolation
title: Domains are the unit of isolation
kicker: Domains & isolation
---
A domain is a logical namespace — everything inside one is invisible to every other domain, in every engine. There is no cross-domain read, scan, or query anywhere in LuraDB; isolation is structural, not a permission you could accidentally misconfigure.

1. **Names are validated the same way everywhere.** Max 50 characters, `[a-zA-Z0-9_-]` only, unique within its engine's registry — creating a duplicate answers `409 Conflict`.
2. **KV, JSON, and REL keep separate registries.** A domain called `shop` in KV, JSON, and REL is really three independent registrations that merely share a name. Nothing is provisioned automatically across engines, and none of them can see another's data.
3. **Deletion is asynchronous.** `DELETE` answers `202 Accepted` immediately; the domain is masked from reads right away while a background purger physically removes its data.
4. **JSON and REL expose the in-between state, KV does not.** A JSON or REL domain response carries `"state": "active" | "deleting"`, and any CRUD against a `deleting` domain answers `410 Gone` (see [errors & status codes](docs:errors-status-codes)). KV instead drops the domain's metadata immediately on delete — it simply disappears from `GET /store-api/domains` while its keys are swept from storage in the background.

## Example

```
POST /store-api/domains
{ "name": "shop" }

→ 201 { "name": "shop", "created_at": 1752600000 }

POST /store-api/domains
{ "name": "shop" }

→ 409 Conflict — domain already exists
```

---
related: kv-engine | Key-Value engine
related: json-documents-indexes | JSON documents & indexes
related: errors-status-codes | 404 vs 410
