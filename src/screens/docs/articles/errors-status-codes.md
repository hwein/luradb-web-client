id: errors-status-codes
category: Errors & status codes
title: What the status code is telling you
kicker: Errors & status codes
---
Every endpoint across all three engines maps its failures onto the same small set of HTTP status codes. Knowing the six below covers almost everything you'll see.

1. **`400` — the request is malformed.** Bad domain/table/index names, SQL syntax errors, a wrong parameter count, a search filter on an unindexed field, `col = NULL` instead of `IS NULL`. Fix the request; retrying it unchanged always fails the same way.
2. **`401` — no valid key.** Missing or wrong `Authorization: Bearer …`. `GET /version` deliberately answers `401` to anonymous callers too — exact version numbers are reconnaissance data — but `GET /health` always stays public.
3. **`403` — valid key, insufficient role.** A `User` with no permission entry for the domain, or with only `read` attempting a write.
4. **`404` — genuinely doesn't exist.** The domain/table/column/index/document/key/user was never created, or has already been fully purged.
5. **`409` — conflicts with the current state.** Covers plain duplicates (domain/table/index/user names) and two cases worth knowing by name: a **version conflict** (an `If-Match` on a JSON document, or a relational unique/primary-key clash) means someone else wrote first; a **dangling write** means an `INSERT`/`UPDATE` set a `KVREF`/`JSONREF` whose target doesn't exist (see [cross-engine links](docs:cross-engine-links)).
6. **`410` — mid-deletion, not missing.** A domain (or an object inside one) that a background purger is actively clearing out. Different from `404`: `410` means it existed and is on its way out; `404` means there is nothing to find.

## Example

```
PUT /store-api/json/shop/documents/cus_8102
If-Match: "3"
{ "name": "M. Keller", "city": "Bochum" }

→ 409 Conflict — version mismatch (current ETag is "4")
```

---
related: cross-engine-links | Dangling links
related: lurasql | LuraSQL error codes
