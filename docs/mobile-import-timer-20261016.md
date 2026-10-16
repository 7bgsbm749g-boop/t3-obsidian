# Mobile imports with future thread runs

An iPhone import with **Follow future runs in this thread** enabled could fail
with `import_node_timers.setTimeout` undefined. Importing the selected response
preceded registration of the future-run stream, so the note could already have
its response and import receipt when the error appeared.

The shared event-command forwarding path used `desktopPause` while waiting for
the vault project machine's acknowledgement. Its lazy import loaded
`node:timers`, which is unavailable on mobile. An immediate acknowledgement
bypassed the wait and hid the problem.

Mobile event commands now wait with the browser timer. Desktop commands retain
their Node timer so background renderer throttling cannot delay host polling.
The fix also applies to the shared subscription and stream-management commands.

`tests/mobile-import.test.ts` loads the packaged browser bundle with Node imports
forbidden. Completed and running imports wait for delayed host acknowledgements,
register future runs, retain the import receipt, and retry without inserting a
second response or stream. The tests failed on the Node timer import before the
fix and pass afterward. They do not establish native iPhone coverage.
