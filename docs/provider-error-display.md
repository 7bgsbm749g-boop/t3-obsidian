# Provider error display

Canonical error items use a compact timeline row in Live Preview and Reading
view: a red circle-alert icon and `Provider error` label, a local timestamp on
the right, and the plain-text message below the label. Theme colours apply in
light and dark mode. Long messages wrap within the response. Normal notices
keep their existing presentation.

When the session repeats the same error item, the message appears once at its
original timeline position. A session error without a canonical item uses the
same display. Neither display completes a running turn.

`tests/response-emissions.test.ts` checks timeline order, timestamps, plain-text
escaping, terminal deduplication, history modes, fallback errors and stream
updates. Run `npm test` for the affected checks and build.

For a real Obsidian desktop check, build a new unsynced fixture:

```sh
node scripts/build-native-response-lab.mjs evidence/TASK --provider-errors
```

Launch its returned profile through Cua. The fixture checks Live Preview and
Reading view, captures light/dark and wrapping screenshots outside the vault,
and deletes its notes through the Obsidian vault API. It sends no T3 work and
creates no T3 threads or QLO2 content. Desktop evidence does not establish
native mobile coverage.
