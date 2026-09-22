# Cookframe

> Every recipe you keep, in one shape you can actually cook from.

Cookframe is an open-source, self-hosted recipe system. You point it at a recipe — a photograph of
a cookbook page, a handwritten card, a recipe website — and it converts that source into one
consistent recipe model, then shows you the part of it you need for what you are doing right now.

**This is work in progress, built in the open.** See [Status](#status) before you try to use it.

## The problem

Recipes all contain roughly the same kinds of information: a title, how much it makes, ingredients
and quantities, steps, times, temperatures, notes, equipment. Every source presents them
differently, and the differences are your problem to solve, every time:

- you translate each source's layout in your head before you can start;
- you jump between the ingredient list and the steps, repeatedly;
- you read ahead so the dough that needs two hours does not surprise you at eight o'clock;
- you try to remember which half of "200 g butter, divided" you already used;
- you re-type the same ingredients into a shopping app;
- and a recipe you liked is gone when the book is at home or the website is not.

Collecting recipes is easy. Keeping them in a form you can cook from is the part nobody does for
you.

## What Cookframe does about it

One conversion, with a durable middle:

```text
untrusted source  →  Source Snapshot  →  Canonical Recipe  →  what you need right now
 photo, card,        what the source      the recipe's facts,   discovery · shopping
 recipe URL          actually said,       normalized, nothing   preparation · cooking
                     kept verbatim        invented
```

Three ideas carry the whole thing:

**Nothing gets invented.** A normalized recipe holds what its source holds. A required field the
source does not supply stays empty and says so, instead of being filled with something plausible
([PDR-0005](docs/product-decisions/PDR-0005-a-required-field-the-source-does-not-supply-stays-empty-and-says-so.md)).
When a photograph turns out to hold four recipes instead of one, you are told, rather than quietly
given the first one.

**The Canonical Recipe is the centre; everything else is replaceable.** Shopping apps, model
providers, hosting and external schemas are adapters around it, not part of it. And what the source
said is kept alongside the recipe drawn from it, so a better model or a newer ontology can re-convert
a library you already have — without you photographing anything twice.

**Your instance is yours.** Cookframe is built for one person running one instance, with their own
credentials, their own database, and their recipes on their own machine — not a service you sign
up for. The mobile client is [an iOS Shortcut in this repository](shortcut/), and it carries no
credential and no instance address until you fill them in yourself.

## Status

**In development. Nothing here is released or versioned, and nothing about it is supported.** What
follows is where it stood on 2026-09-22.

An instance runs as a process, keeps its library in PostgreSQL across a restart, and serves three
pages behind a credential: the library, a recipe, and a cooking view derived from that recipe. You
capture into it by photographing a page with the Shortcut, which posts the image to your instance
and gets back the recipe it saved.

The scan-to-shop path has been measured end to end against real photographs rather than estimated —
eleven pages through a real model, a median of about 20 seconds from submission to a shopping
document, and three of the eleven refused. Two of those three refusals were wrong, and the write-up
says so and says why:
[`spikes/sl5-scan-to-shop/RESULT.md`](spikes/sl5-scan-to-shop/RESULT.md).

Not there yet, stated as plainly as the rest:

- **Importing from a URL is not reachable from a running instance.** The import path exists and is
  tested, including the structured-data route and the refusal to fetch internal addresses, but
  nothing exposes it over HTTP yet.
- **The shopping handoff is not wired into the pages either.** The Schema.org document and the
  capability URL that serves it work and are tested; no page issues you such a URL, so today only a
  test harness can reach one.
- **Capture quality has not passed its own gate.** The threshold run against real photographs
  returned FAIL, and the thresholds themselves turned out to be under-specified for sources a human
  transcribes ([`docs/open-questions.md`](docs/open-questions.md), OQ-14).
- **The photograph you submit is converted and then not kept.** Byte storage is built and tested,
  but a running instance wires none, so there is nothing behind a recipe's image and the pages
  render without one.
- **Nothing re-converts a recipe you already have.** Re-normalizing a stored source is what keeping
  the source is *for*, and it happens today only as part of an import.
- **No library search, and no accounts** — an instance has two credentials, not users.

## What you will find in this repository

Start at [`docs/README.md`](docs/README.md), which indexes the rest. The short version:

| If you want to know | Read |
| --- | --- |
| what the product is for and where V1 stops | [`docs/product-vision-and-scope.md`](docs/product-vision-and-scope.md) |
| what a Source Snapshot, a Canonical Recipe and a Cooking Plan are | [`docs/recipe-ontology.md`](docs/recipe-ontology.md) |
| why the cooking view looks the way it does | [`docs/cooking-ux.md`](docs/cooking-ux.md) |
| how sources and outputs plug in | [`docs/adapter-architecture.md`](docs/adapter-architecture.md) |
| how a model is used, and how stored sources are re-converted | [`docs/ai-processing-and-reprocessing.md`](docs/ai-processing-and-reprocessing.md) |
| what stays public and what never leaves your instance | [`docs/open-source-self-hosting-principles.md`](docs/open-source-self-hosting-principles.md) |
| how a claim about this system gets to count as proven | [`docs/validation-and-evaluation.md`](docs/validation-and-evaluation.md) |
| why something is built the way it is | [`docs/adr/`](docs/adr/) and [`docs/product-decisions/`](docs/product-decisions/) |
| what is still undecided, and what would decide it | [`docs/open-questions.md`](docs/open-questions.md) |
| what governs this repository on GitHub, and who checked it | [`docs/repository-protections.md`](docs/repository-protections.md) |

Two conventions worth knowing before you read a decision record: an accepted record is never
rewritten — it is superseded by a new one — and an open question keeps its number forever, so a
record can name the question it closes.

## Running an instance

You need Node 26, a PostgreSQL database and an OpenAI API key. Copy
[`.env.example`](.env.example) and fill it in. There are no defaults: an instance that is missing
configuration refuses to start and names every variable at fault, instead of guessing one. Then
apply both migrations, in order, and start it:

```bash
npm ci
psql "$DATABASE_URL" -f migrations/0001-the-recipe-store.sql
psql "$DATABASE_URL" -f migrations/0002-the-cooking-plan.sql
npm start
```

There is no migration runner and no version table: these are files you apply, and applying one
twice fails loudly rather than passing over a database that already holds recipes.

It would rather not start than start half-configured. It reads the database *before* it binds its
port, so a database it cannot reach, or one whose migrations have not been applied, stops it with a
message saying so — instead of an instance that comes up fine and then answers every page with an
error. It also refuses to start if the phone's credential and the library's are the same value,
which would let a lost phone open your library while every route still behaved correctly.

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup in full, including how to run the checks.

If you would rather just look: the repository's own test suite is the most honest description of
what works, and every test is meant to be readable as an argument about why it is evidence.

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, the
checks, and the few rules that keep the project coherent.
[`SECURITY.md`](SECURITY.md) covers reporting a vulnerability — please do that privately rather
than in a public issue.

## License

Cookframe is licensed under the [MIT License](LICENSE).
