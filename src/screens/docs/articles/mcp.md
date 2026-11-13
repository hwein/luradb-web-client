id: mcp
category: MCP
title: Connecting AI assistants over MCP
kicker: MCP
---
Since LuraDB 0.5.1 the server ships a built-in MCP server (Model Context Protocol). AI assistants reach LuraDB with the same API keys and domain permissions as REST clients, and nothing changes for REST clients. This client keeps talking REST only — it has no MCP feature of its own.

1. **Opt-in, on its own port.** Add an `[mcp]` section to `luradb.toml`; `enabled` is `false` by default. The MCP server runs its own listener, by default on `port = 3100`, which must differ from the REST ports. The endpoint is `/mcp` (Streamable HTTP), TLS follows the REST listener (`server.tls_enabled`), and the keys are the same API keys as for the REST API.
2. **Reading is always on; writing and structure are switches.** The explore and read tools are always there. `read_only` is `true` by default, which leaves only the read tools; the write tools need `read_only = false`. The structure tools additionally need `allow_ddl = true` (default `false`, only effective with `read_only = false`). No tool deletes structure — no `DROP`, no deleting domains or indexes — and backups, logs, config and auth management are not available over MCP.
3. **The key's permissions are the assistant's permissions.** Every call runs with exactly the permissions of the API key: role, domain permissions and SQL levels. `tools/list` hides the tools the role and the switches rule out.
4. **Sign in with the key or on the OAuth page.** Without OAuth, send the header `Authorization: Bearer <key>` to `https://<host>:3100/mcp`; clients without a header option connect through the local bridge process `mcp-remote` with the same header. With OAuth (`oauth_enabled = true`, which needs `auth.enabled = true` and `public_url`) the client registers itself, you enter your API key on the server's sign-in page (`GET /oauth/authorize`) and allow access; PKCE S256 is required. The token carries no permissions of its own — it belongs to the user of the key you entered, and revoking that key invalidates the token.
5. **Four groups of tools.** Explore, Read, Write and Structure — listed under Tools below. Write works only with `read_only = false`, Structure only with `allow_ddl = true`.
6. **Security notes.** `allowed_origins` (default `[]`) lists the origins of browser-based MCP clients. `public_url` must be `https://` unless it points to loopback. The key belongs in the client configuration, never in a URL.

## Tools

| Group | Tools |
| --- | --- |
| Explore | `whoami`, `health`, `metrics`, `list_domains`, `describe_domain`, `list_tables`, `describe_table`, `list_views`, `list_json_indexes` |
| Read | `kv_get`, `kv_scan`, `kv_count`, `json_get`, `json_list`, `json_search`, `json_count`, `sql_query` |
| Write | `kv_put`, `kv_delete`, `kv_set_null`, `json_put`, `json_delete`, `sql_execute` |
| Structure | `create_domain`, `create_json_index`, `sql_ddl` |

## Example

```
[mcp]
enabled = true
port = 3100
read_only = true
allow_ddl = false
```

```
claude mcp add --transport http luradb https://<host>:3100/mcp --header "Authorization: Bearer <key>"
```

---
related: auth-permissions | Auth & permissions
related: getting-started | Getting started
