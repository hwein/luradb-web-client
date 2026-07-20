// Repräsentative luradb.toml als Test-Fixture (spec config/001): reale Keys/Werte aus dem Prototyp
// (Z. 279–368) + Sektionsliste der Spec. Deckt Kommentare, auskommentierte Keys, alle Werttypen,
// eine Array-of-Tables ([[auth.admins]]) und eine dotted Section ([log.modules]) ab — fordert den Patcher.
export const REFERENCE_TOML = `# LuraDB server configuration
# Read once at startup — replace this file and restart to apply changes.

[server]
bind_address = "127.0.0.1"
port = 3000            # HTTP listen port
swagger_enabled = true
swagger_url = "/test-ui"
hello_enabled = true
# workers = 4          # auto-detected when unset

[auth]
enabled = true

[[auth.admins]]
name = "admin"
api_key = "lura_changeme_please"

[storage]
db_path = "luradb.db"
wal_path = "luradb.wal"
vlog_path = "luradb.vlog"
sstable_dir = "luradb_sstables"

[buffer_pool]
pool_size = 1024

[lsm]
vlog_inline_threshold = 1024
memtable_size_threshold = 4194304
max_key_length = 256
max_value_size = 524288
flush_check_interval_ms = 100
compaction_check_interval_ms = 1000

[compaction]
l0_threshold = 4
l1_max_size = 104857600
level_size_ratio = 10

[janitor]
check_interval_secs = 60
dead_bytes_threshold = 0.30

[domains]
max_name_length = 50
default_domain = "default"
purger_batch_size = 100

[rate_limit]
default_read_iops = 1000
default_write_iops = 500

[log]
level = "verbose"
format = "text"
rotation = "daily"
retention_days = 30
# path = "/var/log/luradb.log"   # stdout when unset

[log.modules]
rel = "info"
json = "info"
kv = "info"

[proxy]
trusted_proxies = ["127.0.0.1", "::1"]
`
