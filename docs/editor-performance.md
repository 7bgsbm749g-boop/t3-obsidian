# Editor performance and response recovery

Logging remains disabled. Response location recovery builds a shared index on
its first miss, reads newly appearing paths incrementally, and immediately
refreshes files reported by vault/editor change events. Repeated missing
responses no longer reread the entire vault every three seconds. An independent
fallback sweep catches missed events after two minutes, then four minutes,
then at most once every five minutes. A move arriving through an observed event
or a newly appearing path bypasses that delay. Duplicate identities still pause
writing, code-fenced example markers remain excluded, and removed response
markers still reach the conflict guard.

Marker indexing parses each document once instead of once per response ID.
Markdown code ranges are reused for identical source text, bounded to 32 entries
and two million retained source characters; callers receive independent copies.
Marker-free documents skip code parsing.

Folder badge observers attach only to file explorer containers. Workspace
layout changes rebind them when an explorer opens, closes, or is replaced.
Typing, scrolling, and reply rendering outside the explorer do not schedule
folder decoration.

A read-only reproduction against QLO2's 513 Markdown notes read 514 paths on
initial recovery, then only the missing preferred path on subsequent rounds.
Repeated rounds took about 2ms on the VPS, compared with the earlier 0.8–1.3s
full scans. This is a source benchmark, not a Windows typing latency measurement.
