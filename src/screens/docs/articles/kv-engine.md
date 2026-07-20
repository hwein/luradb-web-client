id: kv-engine
category: Key-Value engine
title: Keys, values, and the null state
kicker: Key-Value engine
---
The KV engine is the plain key → bytes store underneath LuraDB. Keys are UTF-8 strings addressed one at a time; there is no query language here, only direct access and prefix scans.

1. **A key is a permanent identifier.** `PUT` upserts its value, `GET` reads it back as raw bytes (`404` once it's gone or expired), `DELETE` removes it for good and is idempotent — deleting the same key twice still answers `204`. There is no rename.
2. **`PATCH …/{key}/null` is a tombstone, not a delete.** It is meant to leave the key registered while emptying its content. Today the server writes the same tombstone for `set_null` as for `DELETE`, so a `GET` afterwards answers `404` either way — that's a known gap, not a design choice. (A zero-byte `PUT`, by contrast, does keep the key readable: `GET` answers `200` with an empty body.)
3. **`?prefix=` scans keys without touching values.** `GET …/keys?prefix=user:` lists matching keys only — an index-only operation, safe to use for discovery even on large domains.
4. **`ttl` is a query parameter on `PUT`.** Omit it to store the key indefinitely; set it in seconds to have the key read back as absent once it expires. Every `PUT` starts the lifetime over — writing without `ttl` makes a previously expiring key permanent, and the remaining time is not readable anywhere.
5. **`watch` streams changes over SSE.** `GET …/watch?prefix=` stays open and emits `set`/`delete` events for matching keys until the client disconnects, with an automatic keep-alive ping. Expiry is silent: a key running out emits no `delete` event.

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
