id: getting-started
category: Getting started
title: Connect to a running server
kicker: Getting started
---
The client talks to LuraDB exclusively over its REST API — every store endpoint lives under `/store-api`, and there is no other protocol underneath. Before you can browse a domain or run a query, the client needs a bearer key and has to agree with the server on a compatible API version.

1. **Every request carries a bearer key.** `Authorization: Bearer lura_<64 hex chars>`. Get one from an admin (`[[auth.admins]]` in `luradb.toml`) or have an admin create you a user via `POST /store-api/auth/users`.
2. **Connecting starts with a version handshake.** The client calls `GET /version` with the key before doing anything else. `401` means the key is invalid — connection refused with a clear message, not a silent retry.
3. **Compatibility is major-version-exact, minor-version-lenient.** The client and server must agree on the major version; the server may be newer in minor/patch (you get a one-time warning) but never older than the bundled contract.
4. **Browser mode never reaches the server directly.** Without CORS support on the server, `npm run dev` always goes through the same-origin dev proxy; a proxy failure (502/503/504) is treated the same as a network-level "unreachable". The desktop build is the only mode that opens a direct connection, using the URL you enter — prefer a literal `127.0.0.1` over `localhost` there: if the server publishes only on IPv4 (the usual Docker binding), `localhost` may resolve to IPv6 `::1` first and read as unreachable.

## Example

```
GET /version
Authorization: Bearer $LURADB_KEY

→ 200 { "server_version": "0.2.0", "api_version": "0.2.0" }
```

---
related: domains-isolation | Domains & isolation
related: auth-permissions | Bearer keys & roles
