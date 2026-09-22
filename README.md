# Cookframe

> Any recipe source — a cookbook photo, a handwritten card, a website — turned into one consistent
> recipe you can shop from and cook from.

Your recipes come from books, screenshots and websites, and every one of them is laid out
differently. Cookframe converts any of them into one consistent recipe, then shows you the part of
it you need for what you are doing right now: deciding, shopping, getting ready, or standing at the
stove with your hands full.

**This is work in progress.** See [Status](#status) before you try to use it.

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

**One recipe, four different questions.** "Do I want to cook this?", "what do I need to buy?",
"what has to start early?" and "what do I do right now?" each want a different part of the same
recipe. Cookframe derives each of them from the one canonical recipe, rather than handing you a
single page and letting you read it four ways.

## What you can do with it

Working today:

- **Capture a page with your phone.** Photograph a cookbook page or a handwritten card with
  [the iOS Shortcut in this repository](shortcut/). It goes straight to your instance, which keeps
  the photograph, saves the recipe and tells you what it saved it as.
- **Import a recipe from a link.** A URL goes to your instance on its own address, with the same
  credential a photograph uses and through the same processing afterwards: the page's own
  structured data is read first, and a model reads the page only when that data is missing or
  unusable.
- **One consistent recipe, whatever the source.** Title, yield, ingredients with their quantities,
  steps, times, temperatures, equipment — in the same shape every time, with what the source
  actually said kept alongside it.
- **Your library on one page**, and each recipe on its own.
- **A cooking view derived from the recipe**, not a rewrite of it: what to get out first, what has
  to start early, and the step you are on.
- **A refusal instead of a guess.** A photograph holding four recipes is refused and says so; a
  field the source never gave stays empty and says so.

Built and tested, but not reachable from a running instance yet — the section below says why each
one is still here:

- handing a shopping list to Bring, as a Schema.org page at a URL that grants one recipe;
- a picture of the dish on a recipe's page;
- re-converting a recipe you already have with a better model or a newer ontology.

## Status

**In development. Nothing here is released or versioned, and nothing about it is supported.** What
follows is where it stood on 2026-09-22.

An instance runs as a process, keeps its library in PostgreSQL across a restart, and serves its
three pages behind a credential.

The scan-to-shop path has been measured end to end against real photographs rather than estimated —
eleven pages through a real model, a median of about 20 seconds from submission to a shopping
document, and three of the eleven refused. Two of those three refusals were wrong, and the write-up
says so and says why:
[`spikes/sl5-scan-to-shop/RESULT.md`](spikes/sl5-scan-to-shop/RESULT.md).

Not there yet, stated as plainly as the rest:

- **The shopping handoff is not wired into the pages.** The Schema.org document and the
  capability URL that serves it work and are tested; no page issues you such a URL, so today only a
  test harness can reach one.
- **Capture quality has not passed its own gate.** The threshold run against real photographs
  returned FAIL, and the thresholds themselves turned out to be under-specified for sources a human
  transcribes ([`docs/open-questions.md`](docs/open-questions.md), OQ-14).
- **A recipe's page has no picture.** Rendering one is built and tested and not wired into the
  pages, and nothing gives a recipe one to render: a photographed cookbook page is kept, but it is
  deliberately not treated as a picture of the dish
  ([`docs/recipe-ontology.md`](docs/recipe-ontology.md)), and nothing else supplies one yet.
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
| what is public in this repository and what never leaves an instance | [`docs/open-source-self-hosting-principles.md`](docs/open-source-self-hosting-principles.md) |
| how a claim about this system gets to count as proven | [`docs/validation-and-evaluation.md`](docs/validation-and-evaluation.md) |
| why something is built the way it is | [`docs/adr/`](docs/adr/) and [`docs/product-decisions/`](docs/product-decisions/) |
| what is still undecided, and what would decide it | [`docs/open-questions.md`](docs/open-questions.md) |
| what governs this repository on GitHub, and who checked it | [`docs/repository-protections.md`](docs/repository-protections.md) |

Two conventions worth knowing before you read a decision record: an accepted record is never
rewritten — it is superseded by a new one — and an open question keeps its number forever, so a
record can name the question it closes.

## Running an instance

You need Node 26, a PostgreSQL database, a directory to keep photographs in and an OpenAI API key.
Copy [`.env.example`](.env.example) and fill it in. There are no defaults: an instance that is
missing configuration refuses to start and names every variable at fault in one message, with the
database URL refused a line later by the store's own seam, which also rejects a URL no PostgreSQL
driver could connect with. Then apply both migrations, in order, and start it:

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
error. It writes to the photograph directory before binding too, so one it cannot write stops it
the same way. It also refuses to start if the phone's credential and the library's are the same value,
which would let a lost phone open your library while every route still behaved correctly.

To capture into it from a phone, import [`shortcut/Capture Recipe.plist`](shortcut/). It asks for
your instance's address and its ingest credential on first run and keeps them in your own copy —
the file in this repository carries neither, and the credential it asks for reaches nothing but the
capture endpoint.

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup in full, including how to run the checks.

If you would rather just look: the repository's own test suite is the most honest description of
what works, and every test is meant to be readable as an argument about why it is evidence.

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, the
checks, and the few rules that keep the project coherent.
[`SECURITY.md`](SECURITY.md) covers reporting a vulnerability — please do that privately rather
than in a public issue.

## License

Cookframe is licensed under the
[GNU Affero General Public License, version 3 or later](LICENSE). You may run it, read it, change
it and pass it on. If you change it and offer it to other people over a network, you have to offer
them your changed source too.

Copyright in the project is held by its maintainer, who is therefore also free to license the same
code on other terms. That is why [`CONTRIBUTING.md`](CONTRIBUTING.md) asks an outside contributor
to agree to the same, before their first change is merged.
