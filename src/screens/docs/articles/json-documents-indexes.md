id: json-documents-indexes
category: JSON documents & indexes
title: Documents, versions, and indexed search
kicker: JSON documents & indexes
---
The JSON engine stores schemaless documents per domain. Every document carries its own key and version, and search only ever reaches fields you've explicitly indexed.

1. **Two ways to create.** `POST …/documents` generates a UUIDv4 key for you (create-only, `201`); `PUT …/documents/{key}` upserts under a key you choose (`200` on update, `201` on first write).
2. **`_key`/`_version` ride along with the content.** `GET` returns them as top-level fields next to your document, and the same version is exposed as an `ETag` response header.
3. **`If-Match` makes a write conditional.** Send the `ETag` you last read back as `If-Match: "<etag>"` on `PUT`/`DELETE`; a version that has moved on answers `409 Conflict` instead of silently overwriting it.
4. **Indexes are opt-in and field-scoped.** `POST …/indexes` with `{"field": "address.city", "type": "string"}` — dot notation reaches into nested fields. A new index does not back-fill existing documents; trigger `POST …/reindex` for that and poll `GET …/reindex/{task_id}` for progress.
5. **`search` only reaches indexed fields.** A filter is `{"field": value}` for equality, or `{"field": {"$gt": …}}` (`$gte`/`$lt`/`$lte`/`$eq` too) for ranges; multiple fields are ANDed, and filtering on a field without an index answers `400`.

## Example

```
PUT /store-api/json/shop/documents/cus_8102
{ "name": "M. Keller", "city": "Essen" }

→ 201
ETag: "1"

POST /store-api/json/shop/search
{ "filter": { "city": "Essen" } }

→ 200 { "documents": […], "keys": ["cus_8102"], "total": 1, "offset": 0, "limit": 50 }
```

---
related: cross-engine-links | JSONREF columns
related: errors-status-codes | Versioning & 409
