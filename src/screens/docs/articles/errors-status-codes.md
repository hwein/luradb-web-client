id: errors-status-codes
category: Errors & status codes
title: What the status code is telling you
kicker: Errors & status codes
---
Every endpoint across all three engines maps its failures onto the same small set of HTTP status codes. Knowing the ten below covers almost everything you'll see.

1. **`400` — the request is malformed.** Bad domain/table/index names, SQL syntax errors, a wrong parameter count, a search filter on an unindexed field, `col = NULL` instead of `IS NULL`. Fix the request; retrying it unchanged always fails the same way.
2. **`401` — no valid key.** Missing or wrong `Authorization: Bearer …`. `GET /version` deliberately answers `401` to anonymous callers too — exact version numbers are reconnaissance data — but `GET /health` always stays public.
3. **`403` — valid key, insufficient role.** A `User` with no permission entry for the domain, or with only `read` attempting a write.
4. **`404` — genuinely doesn't exist.** The domain/table/column/index/document/key/user was never created, or has already been fully purged.
5. **`409` — conflicts with the current state.** Covers plain duplicates (domain/table/index/user names) and two cases worth knowing by name: a **unique/primary-key clash** in a relational table means someone else wrote first; a **dangling write** means an `INSERT`/`UPDATE` set a `KVREF`/`JSONREF` whose target doesn't exist (see [cross-engine links](docs:cross-engine-links)).
6. **`410` — mid-deletion, not missing.** A domain (or an object inside one) that a background purger is actively clearing out. Different from `404`: `410` means it existed and is on its way out; `404` means there is nothing to find.
7. **`412` — a write precondition does not hold.** A KV or JSON single-key write carried `If-Match` and the stored version differs or the key doesn't exist, or carried `If-None-Match: *` and the key already exists. Nothing was written. The `ETag` header holds the current version (absent when the key doesn't exist), so the client can reload and decide.
8. **`428` — the domain demands a precondition.** A domain created with `require_conditional_writes` rejects single-key `PUT`, `DELETE` and `PATCH …/null` (and JSON `PUT`/`DELETE`) that carry neither `If-Match` nor `If-None-Match: *`. Add one of the headers; bulk operations are not affected.
9. **`503` — overloaded, try again.** Under load any endpoint can answer `503 Service Unavailable` (plain text) with `Retry-After: 1`; the request was not processed and is safe to repeat. `GET /health` also answers `503`, with its full JSON body and `status` `degraded`, when a data shard does not respond, and `GET /store-api/metrics` answers `503` while no data shard is running. The client appends the wait to the error message (` · retry in <n> s`) and does not retry on its own.
10. **`507` — out of disk space or memory.** When disk space or memory runs low, writes answer `507 Insufficient Storage` (plain text) with `Retry-After: 5` and are not applied; reads keep working. Waiting alone does not help: the operator has to free space or memory. The server's message already names the wait (`retry in 5 s`); the client shows it and does not retry on its own.

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
