id: json-documents-indexes
category: JSON documents & indexes
title: Documents, versions, and indexed search
kicker: JSON documents & indexes
---
The JSON engine stores schemaless documents per domain. Every document carries its own key and version, and search only ever reaches fields you've explicitly indexed.

1. **Two ways to create.** `POST …/documents` generates a UUIDv4 key for you (create-only, `201`); `PUT …/documents/{key}` upserts under a key you choose (`200` on update, `201` on first write). `PUT` with `If-None-Match: *` is create-only: `201` if the key is free, `412` if it is taken.
2. **`_key`/`_version` ride along with the content.** `GET` returns them as top-level fields next to your document, and an opaque `ETag` response header (`"<hash>-<version>"`) that identifies this exact state. Only `GET` returns it; a `PUT` response carries no `ETag`.
3. **`If-Match` makes a write conditional.** Send the `ETag` you last read back as `If-Match: "<etag>"` on `PUT`/`DELETE`; if the document has moved on, the answer is `412 Precondition Failed` with the current `ETag` (absent when the document no longer exists) instead of a silent overwrite. Take the value from a `GET` as is — an `ETag` you build yourself answers `400`.
4. **Indexes are opt-in and field-scoped.** `POST …/indexes` with `{"field": "address.city", "type": "string"}` — dot notation reaches into nested fields. A new index does not back-fill existing documents; trigger `POST …/reindex` for that and poll `GET …/reindex/{task_id}` for progress.
5. **`search` only reaches indexed fields.** A filter is `{"field": value}` for equality, or `{"field": {"$gt": …}}` (`$gte`/`$lt`/`$lte`/`$eq` too) for ranges; multiple fields are ANDed, and filtering on a field without an index answers `400`.

## Example

```
PUT /store-api/json/shop/documents/cus_8102
{ "name": "M. Keller", "city": "Essen" }

→ 201

PUT /store-api/json/shop/documents/cus_8102
If-None-Match: *
{ "name": "M. Keller", "city": "Essen" }

→ 412

GET /store-api/json/shop/documents/cus_8102

→ 200
ETag: "eef7848e9811168e-1"

PUT /store-api/json/shop/documents/cus_8102
If-Match: "eef7848e9811168e-1"
{ "name": "M. Keller", "city": "Bochum" }

→ 200

POST /store-api/json/shop/search
{ "filter": { "city": "Essen" } }

→ 200 { "documents": […], "keys": ["cus_8102"], "total": 1, "offset": 0, "limit": 50 }
```

---
related: cross-engine-links | JSONREF columns
related: errors-status-codes | Status codes & 412
