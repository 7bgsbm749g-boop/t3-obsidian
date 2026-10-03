# Native send registration blocked by legacy ownership traffic

The user request `5afad3c6-bc82-48eb-8009-9a4fb2ff9b67` timed out
before its planned T3 thread existed. The host retained its native registration,
with migration pending, while over 100 mailbox commands accumulated, mainly
legacy claims. Registration was a prerequisite for prompt dispatch.

The authority scanned all durable lease files to find another writer for each
legacy claim and rewrote discovery indexes individually during startup. One
scan held its serialization lock until the entire mailbox finished. This let
old device-writer traffic delay registration and native checkpoints. Waiting
clients retried rejected claims every heartbeat. A client could also read a
newly migrated record and still send one legacy claim in that maintenance pass.

The fix keeps the fixed native final-save host and old recovery identities:

- Build the authority's record and discovery indexes once from durable leases;
  update the indexes under its existing exclusive host lock.
- Native registrations bypass device-writer election entirely.
- Process up to 24 interactive commands and eight legacy heartbeat/claim
  commands per scan, yielding to native checkpoints between scans.
- Perform bounded, rotating receipt cleanup after answering commands.
- Return a retry delay on denied legacy grants. Updated devices respect that
  delay, back off transport failures, and stop claiming migrated responses.
- Stop device polling of a completed native response after its save and local
  acknowledgement are durable.

`tests/coordinator-backlog.test.ts` uses 417 historical records and 400 legacy
claims, including a 5 ms cost per storage operation. First registration must
finish inside the unchanged 5-second poll budget; replay must remain responsive
with backlog still present; native checkpointing must not await backlog drain.
The first regression fails against the pre-fix authority. A real desktop-storage
regression independently requires first registration within 4.5 seconds with
those same record and command counts. Client regressions cover grant waiting
and migration without another ownership claim.

Release acceptance requires a native reload of the real QLO2 client and a new
bounded delivery using its existing records. The first command must succeed
without retry, and the final response must have durable save and cleanup proofs.
A timeout followed by successful retry is a failed acceptance check. Historical
records must remain present; deleting the backlog is not a fix.

Existing timed-out user requests remain saved on their originating devices.
Do not reconstruct their prompts from current notes or send replacement IDs.
An explicit retry uses the saved original prompt and deterministic T3 IDs.
