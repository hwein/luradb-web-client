id: domains-isolation
category: Domains & isolation
title: Domains are the unit of isolation
kicker: Domains & isolation
---
A domain is a logical namespace — everything inside one is invisible to every other domain, in every engine. There is no cross-domain read, scan, or query anywhere in LuraDB; isolation is structural, not a permission you could accidentally misconfigure.

1. **One name, one rule.** `[a-zA-Z0-9_-]` only, 1 to 50 characters by default (`domains.max_name_length` on the server), unique on the server — creating a duplicate answers `409 Conflict`, also while a domain of that name is still being deleted.
2. **One domain holds all three kinds of data.** `POST /store-api/domains` creates a domain that holds keys, documents and tables alike; `GET` and `DELETE /store-api/domains/{name}` describe and delete it as a whole. There are no separate domains per engine.
3. **Deletion is asynchronous.** `DELETE` answers `202 Accepted` immediately; the domain is masked from reads right away while a background purger physically removes its keys, documents, tables and views. The permissions on the domain are deleted with it.
4. **A domain that is being deleted answers `410 Gone`.** It leaves `GET /store-api/domains` at once — the list shows active domains only — and every request to it, in any engine, answers `410` until the purge is done (see [errors & status codes](docs:errors-status-codes)).
5. **Conditional writes can be made mandatory per domain and engine.** A domain created with `"require_conditional_writes": {"kv": true, "json": true}` answers `428` to single-key and single-document writes without `If-Match` or `If-None-Match: *`; each engine is switched on its own, and the setting is fixed at creation.

## Example

```
POST /store-api/domains
{ "name": "shop" }

→ 201 { "name": "shop", "created_at": 1752600000, "state": "active",
        "require_conditional_writes": { "kv": false, "json": false } }

POST /store-api/domains
{ "name": "shop" }

→ 409 Conflict — domain already exists
```

---
related: kv-engine | Key-Value engine
related: json-documents-indexes | JSON documents & indexes
related: errors-status-codes | 404 vs 410
