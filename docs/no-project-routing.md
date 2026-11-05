# Threads without a vault project

New unlinked sends use T3's native `projects.ensureScratch` operation through
an authenticated API connection. The returned ID remains part of thread,
response, history, import and retry identities. The plugin does not register a
project at the vault root or move old conversations.

A remembered thread wins over a linked folder. The nearest explicit folder link
wins for a new conversation. Otherwise the destination is No project, with an
explicit machine choice in the chooser. An authenticated loopback connection is
preferred when configured; otherwise the selected or sole connected machine is
used. Explicit machine choices, existing threads, saved retries and linked
projects keep their exact environment. A failed explicit selection cannot send
on a different machine.

Sends, reads, controls, reply following and Codebase share environment routing.
Candidates must identify the selected environment and pass an authenticated
read before being exposed. A broken saved endpoint can fall back while opening
access. No caller send, write or control operation is replayed through another
endpoint. Valid device credentials and current discovery state select among
duplicate connections. The plugin does not discover runtime files or execute
the T3 CLI. Account-free manual pairing remains available.

New project remains an explicit choice for an unlinked folder. Empty notes and
cancelled choosers dispatch no thread. Missing linked projects remain errors.
