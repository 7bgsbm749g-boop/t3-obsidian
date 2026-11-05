# Desktop CLI selection

> Historical implementation. Its local command/event runtime was removed. See [checked note edits](checked-note-edits.md) for the current protocol.

The plugin uses the official T3 CLI to issue short-lived local API sessions.
On Windows it prefers `~/.t3/bin/t3.cmd`, which T3 updates to point to the
desktop app's bundled CLI. A leftover standalone `t3.exe` does not take priority
over that launcher. An explicit executable path in plugin settings takes priority
over automatic discovery.

The plugin reads the current generated launcher's executable, entry point and
required environment for each invocation, then starts that executable directly.
It does not run a command shell or interpolate project titles and paths into
batch commands. Launcher targets are not cached, so later T3 updates or moves
are picked up when a new credential is needed. Existing valid credentials retain
their normal short lifetime.

An unsupported or broken launcher stops the operation. It never causes a silent
fallback to an older executable. Open T3 to refresh its launcher, or set an
explicit supported CLI executable. An explicitly selected `.cmd` must use T3's
generated launcher format; arbitrary batch programs are not supported.

Each new local session must pass a read-only API check before it can be used for
delivery or cached. HTTP 401 reports the selected CLI path, CLI version and
running server version. The rejected credential is revoked, and no message is
dispatched. Successful cached sessions record a `verified` event in the bounded
local authentication audit. Diagnostic errors exclude credentials and HTTP
response bodies.
