# Desktop response scans and native laptop reload

The reported `relo` response was registered at 23:33:56 UTC, but its generation
journal did not accept it until 23:37:56. Its note rename was retained under the
same binding and journaled immediately after acceptance. Before acceptance the
editor showed an empty response anchor while T3 already held the answer. The
original binding was subsequently stopped at 23:38:00; that stopped binding is
preserved and is not silently replayed.

2.31.26 gave each coordinated response a separate scan worker, but the outer
`DesktopInlineHost.tick` still coalesced the full scan promise. An unresolved
scan of an older note could therefore prevent later desktop ticks from reaching
healthy responses and writer timeouts. The outer host now lets each tick reach
the coordinator's bounded discovery and per-response workers. Writers retain
their existing per-response exclusion, ownership checks, and checked final saves.

The packaged-desktop regression registers an older response, blocks its journal
read, then registers and renames a fresh response. It requires the fresh reply's
verified final save before releasing the old read, and proves that repeated ticks
do not duplicate the blocked worker. The immutable 2.31.26 bundle fails this
regression with an empty anchor; the repaired bundle passes. Baseline evidence is
retained outside the vault under
`/home/ubuntu/backups/send-to-t3-code/delay-rename-20261004`.

This establishes a real blocking mechanism, not proof that a T3 title rename
caused the historical stall. The observed filesystem note rename was correctly
retained; title changes do not change response IDs.

The release flow also supports the requested native laptop reload. Its private
mailbox checks immutable Sync bytes and saved ordinary views before executing
`app:reload`, Obsidian's **Reload app without saving** command. A durable
acknowledgement precedes native dispatch; replay after a crash can complete that
gap without repeating a reload on a new instance. The VPS retry service coalesces
offline releases and verifies a new running instance with the embedded target
version. It does not perform laptop smoke tests or install artifacts there.

Live release acceptance still requires a real QLO2 reload and a bounded renamed
response with durable completion proof. Unit tests and matching Sync files alone
do not establish visible editor delivery. Native mobile coverage is not supplied
by this desktop regression.
