id: cross-engine-links
category: Cross-engine links
title: KVREF & JSONREF columns
kicker: Cross-engine links
---
A relational table can hold link columns that point into the other two engines of the same domain: a `KVREF` stores a KV key, a `JSONREF` stores a document key. Cross-domain links are impossible by design.

1. **Writes are validated.** Inserting a non-NULL link whose target doesn't exist fails with `409 Conflict`.
2. **Resolution is a request parameter, never SQL.** Add `"expand":["customer_ref"]` to the `/sql` body, or `?expand=*` on browse — the wildcard resolves all link columns ("full resolve").
3. **Dangling links never break a query.** LEFT-JOIN semantics: the row is returned, the expanded entry says `{"exists":false}`. NULL, empty, and deleted are three distinct states.

In practice, the "empty" branch of `KVREF` (`{"exists":true,"value":null}` — a key that exists but was emptied) is not observable yet: the [Key-Value engine](docs:kv-engine)'s `null` write currently produces the same tombstone as a delete, so an emptied KV key resolves exactly like a dangling one. `JSONREF` doesn't have this gap — a document either exists with content or it doesn't.

## Example

```
POST /store-api/rel/shop/sql
{ "sql": "SELECT id, customer_ref FROM orders LIMIT 5",
  "expand": ["customer_ref"] }

→ 200 { "columns": […], "rows": […],
        "expanded": { "customer_ref": [ {"exists":true,"document":{…}}, … ] } }
```

---
try: SELECT id, customer_ref FROM orders LIMIT 5
related: lurasql | LuraSQL · LEFT JOIN
related: errors-status-codes | Errors · 409
