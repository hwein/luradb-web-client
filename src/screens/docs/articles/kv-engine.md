id: kv-engine
category: Key-Value engine
title: Keys, values, and the null state
kicker: Key-Value engine
---
The KV engine is the plain key → bytes store underneath LuraDB. Keys are UTF-8 strings addressed one at a time; there is no query language here, only direct access and prefix scans.

1. **A key is a permanent identifier.** `PUT` upserts its value, `GET` reads it back as raw bytes (`404` once it's gone or expired), `DELETE` removes it for good and is idempotent — deleting the same key twice still answers `204`. There is no rename.
2. **`PATCH …/{key}/null` sets an explicit null state, not a delete.** It is an upsert like any other write: the key stays registered and shows up in scans, but carries no data — `GET` afterwards answers `204`, and it resets a running TTL just like `PUT` does. Only `DELETE` or TTL expiry remove the key. (A zero-byte `PUT`, by contrast, is a different state again: `GET` answers `200` with an empty body.)
3. **`?prefix=` scans keys without touching values.** `GET …/keys?prefix=user:` lists matching keys only — an index-only operation, safe to use for discovery even on large domains.
4. **`ttl` is a query parameter on `PUT`.** Omit it to store the key indefinitely; set it in seconds to have the key read back as absent once it expires. Every `PUT` starts the lifetime over — writing without `ttl` makes a previously expiring key permanent. The remaining time is readable: `GET` carries an `X-Expires-At` header (Unix seconds) while a TTL is set, and `GET …/keys/{key}/meta` returns `expires_at` together with `last_modified_at`.
5. **`watch` streams changes over SSE.** `GET …/watch?prefix=` stays open and emits `set`/`delete` events for matching keys until the client disconnects, with an automatic keep-alive ping. Expiry is no longer silent — a key running out emits a `delete` event like any other removal. Every frame carries an `id:`, so a client that reconnects with `Last-Event-ID` (or `?last_event_id=`) resumes without a gap; when the server cannot guarantee that, it sends `event: reset` instead and the client reloads its state.
6. **Writes can be conditional.** `GET` carries an `ETag` — also on `204`, the null state. `PUT`, `DELETE` and `PATCH …/null` accept `If-Match: <etag>` (write only if the stored version still matches) and `If-None-Match: *` (create only); a failed precondition, or `If-Match` on a missing key, answers `412` with the current `ETag` in the header (absent when the key doesn't exist) and writes nothing. Without a header the last writer wins — unless the domain was created with `require_conditional_writes`, where every single-key write needs one of the two and answers `428` without. Bulk paths such as `DELETE …/keys` with a prefix take no conditions.

## Example

```
PUT /store-api/kv/shop/keys/cart:8102?ttl=3600
cus_8102-session-payload

→ 200

GET /store-api/kv/shop/keys?prefix=cart:

→ 200 ["cart:8102", "cart:9911"]
```

---
related: domains-isolation | Domains & isolation
related: cross-engine-links | KVREF columns
