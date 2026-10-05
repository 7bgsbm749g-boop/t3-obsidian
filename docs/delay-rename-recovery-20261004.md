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

## Release 2.31.27 verification

The real VPS QLO2 client loaded 2.31.27 through the native command. A second
reload through the private mailbox produced a different client instance nonce
with the same embedded version. The bounded live thread
`4a8ffe54-20c1-5026-bbec-e833c916c098` completed after both its T3 title and its
Obsidian note were renamed while the turn was running. Its binding
`c231387c-ea63-5efb-8ae9-830208f5c766` reached `complete`, `finalSaved`,
`cleanupComplete`, and `verifiedOnHost`; verification followed T3 completion by
5.177 seconds. The saved note and visible completed editor were retained outside
the vault, and the immutable acceptance receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.31.27/smoke-vps-qlo2.json`.
The full release suite passed 748 TypeScript and 11 Python tests.

`send-to-t3-native-laptop-reload.timer` is installed and active. The laptop was
offline during verification, so its pending state retains the exact release
hashes. The laptop needs one initial native reload after Sync to activate this
new mailbox handler; native laptop execution and bootstrap remain unverified.
After activation, later immutable releases retry remotely until Sync, ordinary
saved editor buffers, and a newly loaded target instance have been verified.

A later read-only fleet check found the laptop reachable again, with neither
Obsidian nor T3 running. Its disk still held 2.31.26. The retry hook therefore
remains pending client startup and Sync; no laptop reload was claimed. The
follow-up observation is retained in the same evidence directory as
`laptop-observation.json`. The completed synthetic smoke note was removed after
its saved content and lease proof were retained.
