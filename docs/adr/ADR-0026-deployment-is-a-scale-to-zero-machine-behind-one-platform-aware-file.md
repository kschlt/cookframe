---
id: "ADR-0026"
title: "Deployment: a scale-to-zero machine and a sleeping managed Postgres, behind one platform-aware file"
status: accepted
date: 2026-09-22
tags: ["hosting", "deployment", "persistence", "portability"]
constrained_by: ["PDR-0002"]
supersedes: ["ADR-0011"]
depends_on: ["ADR-0009", "ADR-0015"]
related_to: ["ADR-0007", "ADR-0008", "ADR-0010", "ADR-0016", "ADR-0021", "ADR-0027"]
decides: ["OQ-05"]
---

## Context

`ADR-0011` closed `OQ-05` on a **rented single-tenant server with its own domain**, on the reasoning
that Bring requires a publicly fetchable URL and that a rented, always-on host is the plainest way to
provide one. The Bring half of that reasoning is unchanged and is re-adopted below. The *always-on*
half rested on an assumption about what the deployment has to be worth, and the maintainer has since
stated the opposite requirement directly:

> "nicht mehr … eine möglichst vollständige und dauerhaft verfügbare Produktionsumgebung … sondern
> eine kleine, bedarfsgesteuerte Anwendung, deren laufende Kosten möglichst nahe null liegen, solange
> sie niemand benutzt."

Four re-weightings come with it, and each of them changes what a host has to provide:

- **Availability is not a quality of this product.** A few seconds of start-up before a recipe
  renders is acceptable; an occasional outage is acceptable. No high availability, no second
  instance.
- **The data must be durable, not continuously available.** The application may be entirely stopped.
  The recipes and the images must survive that and be there at the next start. This is the
  distinction that makes a sleeping database thinkable at all.
- **An own domain is not required to start.** A platform hostname is enough as long as Bring can
  fetch it — with the cost named in *Consequences*, because `ADR-0016` tokens do not expire.
- **A later multi-user web application must stay reachable, and must cost nothing today.**

`ADR-0011` also recorded, in its own words, that **"the own domain is the durable decision; the
specific rented host is an operational choice that can change without changing the domain or the
capability-URL contract."** This record changes both halves of that sentence in the same direction:
it makes the *host* the recorded choice and defers the domain. That is a reversal of emphasis, not of
mechanism, and it is why this record supersedes rather than amends.

Two pieces of the codebase decide more about the viable set than any price list does, and both are
already shipped:

- **The safe-fetch guard is a custom `undici` connector** (`ADR-0010`), which `ADR-0010` itself names
  as "the one place the codebase is not portable in the sense `ADR-0001` means". Whether it behaves
  identically on a given runtime is a property of that runtime, not of the code.
- **The mobile capture route accepts a body up to `MAX_CAPTURE_BYTES` = 25 MiB**
  (`src/http/ingest-app.ts`, `CFV1-SL5`), because an iPhone HEIC is several megabytes and the
  Shortcut posts the image itself. Any runtime with a request-body limit below that breaks the
  shipped contract rather than merely inconveniencing it.

The maintainer ran two independent hosting researches and supplied their results. **Their figures are
quoted here as a third-party claim of 2026-09-22 and are not measurements of ours**; every one of
them is a price or platform limit that can change, and nothing in this record's reasoning depends on
a figure being exact. What the two researches agree on is the shape: an application container that
stops when idle, a managed Postgres that sleeps when idle, and a persistent volume for the images.

Also relevant to the timing: the Postgres persistence of `ADR-0015` and a real server entry point
were both in flight while this record was drafted, and both have since landed. `CFV1-PG` merged as
`8241ef1`, so the library is in PostgreSQL, reached through a `DATABASE_URL` that
`resolveDatabaseUrl` refuses to default. `CFV1-RUN` merged as `35a2c9f`, so `npm start` brings up a
process that binds a port and serves, and a runtime image separate from the CI one runs it. What
this record decided in the abstract is therefore now decidable against real code, and the section
below re-measures it there.

A gap between those two was open while this record was drafted, and it is worth recording because
it is exactly the failure this decision would have caused: the entry point composed
`createProvisionalStore()`, so a deployment would have run correctly and been empty after every
idle stop — on a scale-to-zero machine that is every idle period, not every reboot. `CFV1-WIRE`
closed it at `8a02d2f`. The instance now builds `createPostgresStore(resolveDatabaseUrl())`, and
`ADR-0027` decided the consequence this record's operating model makes acute: the process performs
one real read per migration before it binds, so it refuses to start against a database it cannot
reach or that is half-migrated, rather than coming up and failing every page that reads.

## Decision

The maintainer's instance runs as **one container on a machine that stops when idle and starts on a
request**, against a **managed PostgreSQL whose compute sleeps when idle**, with the images on a
**persistent volume attached to that machine**. Concretely, and as an operational choice rather than
a durable one: a single Fly.io Machine with `auto_stop_machines`/`auto_start_machines` and
`min_machines_running = 0`, a Neon Postgres, a small Fly volume, and the platform hostname as the
public origin until a domain is bought.

Everything that makes that a *decision* rather than a preference is in the four cuts below. They are
what keeps the platform an operational choice — the thing `ADR-0011` claimed for the host and this
record has to earn structurally, because a sleeping database and a mounted volume are the two places
a project of this shape normally acquires a vendor.

1. **Persistence reaches the platform as a connection URL and nothing else.** The database client is
   a plain PostgreSQL driver over TCP configured by `DATABASE_URL`. **No provider-specific driver,
   HTTP-over-`fetch` transport or connection SDK enters the repository** — not for Neon, not for any
   successor. `ADR-0015` is untouched by this record: the same JSONB documents and the same single
   extracted projection, behind the same repository interface of `ADR-0003`. Moving to another
   Postgres is a URL, a restore, and no code.

2. **Byte storage reaches the platform as a directory path and nothing else.** `STORAGE_ROOT`
   (`ADR-0009`) points at the mounted volume. The `storageIdentity` indirection stays the only way the
   rest of the system refers to stored bytes, so the later move to object storage remains the swap of
   one implementation that `ADR-0009` describes, not a data migration. **`ADR-0009` is not
   falsified**: its one environmental assumption is a persistent local disk, and a volume that
   outlives a stopped machine is one.

3. **The HTTP apps stay origin-agnostic, and the public origin stays configuration.** `app.fetch` is
   the whole surface (`ADR-0007`, `ADR-0021`); no app learns its host, port or base URL. The
   capability URL's origin comes from `PUBLIC_BASE_URL` (`ADR-0016`).

4. **Exactly one place in the repository knows which platform this is.** The server entry point, its
   production container definition, and the platform's own configuration file are that place. **No
   module under `src/` may import a platform SDK or read a platform-specific environment variable**
   (`FLY_*` and its equivalents). The entry point reads the port from the environment, binds, and
   hands requests to `app.fetch`; that is the whole of its platform knowledge.

### What checks these cuts, and what does not yet

A cut nobody can turn red is an intention, not portability, so each one is stated here as the
assertion a test has to make — in the form `ADR-0010`'s chokepoint uses, a scan of `src/` with a
declared inventory of what is exempt, so that a file added later is not exempt by default.

Two of them already exist, and both in a better form than this record would have asked for.

`CFV1-RUN` ships `run/only-the-entry-point-binds`, which refuses the server adapter, a socket
module, `createServer` and `.listen` anywhere under `src/` except the one named entry-point file.
It is anchored on module specifiers rather than on the words a file contains, which a first attempt
got wrong: two modules explain the adapter's content-length defect in prose, and a substring match
reported them as offenders. That scan cannot stand alone, and this record does not let it. Its
companion case, that the entry point *is* the file that binds, reads the entry point's text for
`@hono/node-server` and `serve(`, so it rules out the rule passing trivially the day nothing binds
at all — but it is satisfied by a file that contains those tokens without ever reaching them. What
makes the binding real is `run/the-process-serves-and-stops`, which spawns the declared start
command and talks to it over a socket. Cut 4's binding half is the two together.

`slice1/storage-identity-confinement` carries cut 2, and it is worth reading for how it took its
one exemption. `CFV1-RUN`'s composition root reads the prompt files and the `schema/` source it
hands the model, so `node:fs` outside `src/storage/` stopped being an absolute rule. The exemption
names `src/server/main.ts` as a single path rather than a directory, so a second module beside it
is still caught; the rule that forbids minting a `StorageIdentity` outside the store keeps **no**
exemption, so the entry point still cannot resolve one to a path; and a further case pins what the
exemption may do — every read in the exempted file is rooted at `import.meta.url`, so none of them
can be handed a path that came from configuration or from a request. Reading a constant path is
exempted; deriving one is not. That is the distinction cut 2 is actually about, and it is a better
rule than the file count this record first wrote down.

| cut | what a test must assert over `src/` | state |
|---|---|---|
| 1 | the only database package any module imports is `pg` — no provider-specific driver, no HTTP-over-`fetch` transport | owed, and no longer vacuous: `CFV1-PG` landed the store, and `pg` is the only database package under `src/`, imported in exactly one module (`src/persistence/postgres-store.ts`). That is the state the assertion demands, and nothing yet keeps a second module or a provider driver from joining it |
| 2 | no module outside the byte store derives a byte location, and the filesystem is reached only there — save for reading fixed repository assets from a named, pinned exemption | **done**, by `slice1/storage-identity-confinement` (`CFV1-SL1`, exemption added by `CFV1-RUN`) |
| 3 + 4 | no module takes its configuration from the environment except through a declared seam: a parameter, either defaulted from `process.env` at one point in the signature or supplied by the composition root at the call site — never a read inside a function body, and never a module-level constant. The inventory of such seams is declared with the test | owed. Three exist on the merge result, all in the declared shape: `readPlanGenerationPolicy` (`src/cooking/policy.ts`) and `resolveDatabaseUrl` (`src/persistence/configuration.ts`) default the parameter; `readConfiguration` (`src/server/config.ts`) takes it as a required parameter and the entry point's own `readConfiguration(process.env)` call in `src/server/main.ts` is the one place that passes the real `process.env`. The third is the strictest of the three, and it is the shape the test should prefer |
| 4 (binding) | nothing outside the entry point names the server adapter, a socket module, `createServer` or `.listen`, and the entry point really does bind | **done**, by `run/only-the-entry-point-binds` together with `run/the-process-serves-and-stops` (`CFV1-RUN`). The first without the second is green on a file that names the adapter but never starts it |
| 4 (platform) | no module names a platform — `FLY_*` and its equivalents, a platform hostname, a platform SDK | owed. True on the merge result: no platform name appears under `src/`, and the only third-party packages it imports are `hono`, `@hono/node-server`, `undici`, `ipaddr.js` and `pg` |

Every "true" above was measured on the merge result of this branch against `main`, not on the tree
this record was first drafted on. That distinction has now cost four rounds, and each one was the
same mistake: a claim written in the tense of a tree that did not exist yet. The cut-3 row first
read "`process.env` appears nowhere under `src/`", true when written and false when read, because
`CFV1-SL6` landed a seam in between; then it named two seams while one had landed; then `CFV1-PG`
landed the second; then `CFV1-RUN` landed a third in a *different* shape, a required parameter
filled at the call site, which the row as written would have called a violation. So the row now
describes both admissible shapes and says which is stricter, rather than counting. The counts beside
it are re-measured whenever `main` moves, and they moved three times while this record was open:
`CFV1-PG` at `8241ef1`, `CFV1-SGD` at `2dea86f`, `CFV1-RUN` at `35a2c9f`.

Three rows are still owed, and both units that were going to carry them have now merged without
them. That is a debt this record names rather than a plan it proposes: cuts 1, 3 + 4 and 4
(platform) hold on the tree today and nothing keeps them holding. Each test has to start green on
the tree it lands in, so the first thing any of them ever catches is a regression.

Two further commitments, because leaving them implicit is how they get lost:

- **Backup is not the platform's recovery window.** A managed provider's point-in-time window does
  not answer "a recipe was deleted three weeks ago", so the instance keeps its own periodic
  PostgreSQL export plus a copy of the byte directory, held somewhere neither the machine nor the
  database provider controls. `OQ-27` (the export/backup contract) stays open and this record does
  not close it; it fixes only that platform retention is not the answer to it.
- **The documented self-hosting path stays provider-neutral.** The public product is configured by a
  Postgres URL and a directory, so a reader self-hosts Cookframe with whatever Postgres and whatever
  disk they have. **This record decides the maintainer's own instance, not what self-hosting means.**
  That distinction is what keeps it inside `PDR-0002` rather than quietly revising it — see the
  negative consequence below, which states the part that is genuinely in tension.

### What is deliberately not decided here

The production container definition, the entry point's internal design, the machine size, the
connection-pool shape and whether a `start` script or a process manager runs it. Those belonged to
`CFV1-PG` and `CFV1-RUN`, which have both since merged and answered them. This record named their
target and their constraints; it did not design them, and it does not revise them now.

## Consequences

### Positive

- **Idle cost approaches the price of stopped storage.** The dominant term stops being a rented
  server's monthly fee and becomes the seconds the machine actually ran. The third-party research
  puts the whole instance in the low single-digit dollars per month at occasional use; that
  magnitude, not the figure, is what this record relies on.
- **`ADR-0015` and `ADR-0009` are adopted as they stand.** A sleeping managed Postgres is ordinary
  PostgreSQL with JSONB, and a volume is a directory. Neither decision is reopened, and neither
  needed to be, which is what makes this cheap.
- **The one-container composition survives.** `ADR-0005`'s "one service, one `docker compose up`"
  reading still describes the application; the database moved from a process the operator starts to a
  URL the operator supplies, which is strictly less to run.
- **Bring's requirement is met unchanged.** A stopped machine still has a public HTTPS address; a
  fetch starts it. `ADR-0016`'s token contract and `ADR-0021`'s route are untouched, because neither
  ever knew its origin.
- **The later web application is not foreclosed.** Accounts, shared cookbooks and public recipes are
  data-model work, and the Hono handler, the Postgres database and the storage indirection all carry
  over. Cut 4 is what keeps a move to a function runtime a rewrite of one file.

### Negative

- **Part of the data now sits with a provider the operator does not run**, which is the sentence
  `PDR-0002` is most protective of ("self-hosting means the operator holds the machine, the data and
  the credentials — not an account on a platform that holds them"). The resolution taken here is that
  `PDR-0002` governs **what the product documents as self-hosting**, which cuts 1 and 2 keep
  provider-neutral, while this record governs **what the maintainer's instance happens to run on**.
  That reading was put to the maintainer rather than assumed, and answered on 2026-09-22: `PDR-0002`
  binds what is shipped and documented, not the instance he runs himself. This record is accepted on
  that answer. The cost it names does not go away with the answer — part of the data does sit with a
  provider — and cuts 1 and 2 are what keep the documented path free of that provider.
- **A cold start is now on the path of a third party's fetch.** Bring fetches the capability URL
  server-side and its timeout is unknown to us. If a cold start exceeds it, a shopping handoff fails
  in a way no code change can see. Registered as `OQ-45`.
- **The safe-fetch guard's behaviour on the chosen runtime is asserted, not measured.** A container
  on a Linux machine is the environment `ADR-0010` was written for, so the expectation is that it is
  intact — but `ADR-0010` calls this module the codebase's one non-portable place, and an expectation
  is not the evidence that record's other claims rest on. Registered as `OQ-44`.
- **Auto-stop can kill the in-process background generation of `ADR-0008` mid-flight.** This is
  survivable exactly as `ADR-0008` says — the plan is derived data and the next cooking view
  regenerates it, degrading to the shipped `lazy` default — but a machine that stops on idle makes the
  rare case ordinary rather than exceptional, and `ADR-0008` was written before that was true.
- **Deferring the domain has a cost `ADR-0016` guarantees.** Tokens never expire and Bring retains
  the URL it was given, so every capability URL issued under a platform hostname is a permanent link
  to a hostname the operator does not own. Moving to an own domain later means either serving both
  origins or accepting that retained Bring links break. This is accepted deliberately for a private
  first version; it gets more expensive with every recipe handed to Bring, so the domain is a decision
  to revisit early rather than eventually.
- **Two providers instead of one** means two accounts, two sets of credentials and two free-tier
  policies that can change under the instance without notice.

### Neutral

- Which machine size, and whether 512 MiB is enough, is unmeasured. Registered as `OQ-46`.
- This record says nothing about authentication for the private library. The capability route stays
  the only unauthenticated public surface (`ADR-0021`), and the ingest route stays credential-gated
  (`CFV1-SL5`); anything beyond that is the later product decision `ADR-0011` already left open.

## Alternatives considered

**Keep `ADR-0011` as written: an always-on rented VPS with its own domain.** Rejected because its
premise no longer holds. It buys continuous availability and a stable origin, neither of which is now
a requirement, at a monthly fee an order of magnitude above the alternative and with the operating
burden — updates, restarts, certificates, a Postgres to run — falling on one person. Its Bring
reasoning survives it and is re-adopted above.

**A fully serverless deployment: functions plus a managed Postgres plus object storage.** The
closest match to the stated goal and a real candidate, deferred rather than dismissed. Two shipped
facts make it additional work rather than a cheaper start: the capture route accepts 25 MiB bodies
and the platform limit reported by the research is 4.5 MiB, so photo upload would have to be
restructured to upload directly to object storage; and the byte store would have to move off the
filesystem before the first deployment rather than when a second instance makes it necessary. The
third fact is unknown rather than adverse: whether a custom `undici` connector survives that runtime
at all. Spending that work to save a few dollars a month is the wrong trade today, and the same work
becomes worthwhile the moment object storage or a second instance is wanted for its own sake — which
is when this record should be re-read.

**Managed Postgres from the same platform as the machine.** One provider, one bill, one support
path. Rejected on price: the research reports the smallest managed tier at roughly 38 $/month plus
storage, which is more than an always-on VPS and defeats the purpose of this record.

**Postgres in a second container beside the application.** Keeps everything on infrastructure the
operator runs, which is the most faithful reading of `PDR-0002`. Rejected for the first version
because it reintroduces exactly what was removed: a second always-on machine with a disk to back up
and a database to operate, plus a start-ordering problem between the two. Cut 1 keeps it available as
a later move at the cost of a URL.

## What would falsify this decision

- **A cold start that Bring will not wait for** (`OQ-45`), which would force either a minimum running
  instance — removing the idle saving that is this record's whole point — or a different serving path
  for capability URLs.
- **The safe-fetch connector behaving differently on the platform** (`OQ-44`). The URL import is not
  optional and the guard is not negotiable, so a runtime that will not carry it is not a candidate
  whatever it costs.
- **The free tiers changing.** Both providers' free allowances are policy, not contract. If the
  database tier stops being free, this becomes a comparison against an always-on server again, on
  numbers rather than on shape.
- **The byte volume outgrowing one disk, or a second instance becoming necessary**, either of which
  triggers the object-storage move `ADR-0009` anticipates and makes the serverless alternative above
  worth re-reading.
- **The maintainer reversing his 2026-09-22 answer, so that `PDR-0002` binds the instance and not
  only the documentation.** That would reverse the managed-database half of this record on product
  grounds, and correctly. It is the one falsifier here that no measurement can settle.
