---
id: "ADR-0033"
title: "A fake that ignores a field cannot catch a caller that omits it"
status: accepted
date: 2026-09-22
tags: ["testing", "guards", "process", "seams"]
related_to: ["ADR-0004", "ADR-0019", "ADR-0028", "ADR-0029"]
---

## Context

ADR-0004 puts the model behind a capability seam that is an injected argument. Production wires
the real provider, and the tests wire a deterministic fake through exactly the same path. That
discipline is why the whole pipeline can be proved without a model, a key or a bill. It also has a
blind spot, and it cost the most of any defect found on 2026-09-22.

`CaptureContext.sourceProvenance` is optional. The shipped capture provider decides on it alone
whether a submission is a photograph (ADR-0019): `"photo"` takes the vision path and the
verification exemption, and anything else, absence included, decodes the bytes as UTF-8 and
verifies the capture against that text. The photo route stated the media type and never stated
the provenance. So every photograph a running instance was sent reached the model as 189,574
characters of decoded bytes, was refused against them, and came back as a 500 after a paid model
call (#104).

**No proof went red.** Every proof of the photo route ran on `createFakeCaptureProvider`, which
does not even declare the context parameter. A route that set the field and a route that omitted
it were indistinguishable to all of them. The fake was not wrong. It answered correctly for every
context it was handed. It could not see the one thing that was missing, because it never looked.

Reviews here ask six fixed questions of every structural claim, each named after a way a proof
has passed while guarding nothing:

1. the named proof guards something beside its name;
2. the planted violation fails somewhere other than at its own assertion;
3. a no-op passes because the happy path already produced the state;
4. the proof builds its own subject, so it shows the code works when called and never that anything
   calls it;
5. a guard's aim is pinned and its breadth is not (ADR-0029);
6. a negative entry is spared for the wrong reason.

This is a seventh, and it is none of the six. The proof was about the right thing, failed at its
own assertion when it failed, and ran the real route. What it could not do was fail. The input
that would have made the route wrong was one the stand-in beneath it was blind to.

### What the tree holds

Measured with the TypeScript checker over `src/`, covering every interface an object literal or
class implements, every optional field of those methods' inputs, and whether each implementation
reads it, directly or through a function it hands the input to:

| seam method | optional input fields | shipped reads | fake reads |
| --- | --- | --- | --- |
| `CaptureProvider.capture` | `captureModel`, `capturePromptVersions`, `sourceMediaType`, `sourceProvenance` | `sourceMediaType`, `sourceProvenance` | none |
| `NormalizationProvider.normalize` | `normalizationModel`, `normalizationPromptVersions` | both, through `stampProvenance` | both |

So the #104 pair is the only instance in the tree. Ten further test doubles of `CaptureProvider`
under `tests/` also ignore the context. They are not the shared fake the harness composes, and the
rule below does not count them.

## Decision

**When a seam input is optional and a shipped implementation reads it, a fake that ignores it
cannot be the only thing its callers are proved against.**

1. **The review asks it.** A seventh question joins the six, for every change that adds or changes
   a seam's input, a fake, or a caller of a seam: *which field does my fake ignore, and which caller
   would get through with it?*

2. **Such a field gets one of two answers.**
   - The field becomes **required**, so the compiler refuses a caller that leaves it out. This is
     the stronger answer and the one to prefer where every caller knows the value.
   - Or a proof **drives the callers through the shipped implementation**, where leaving the field
     out changes what comes back, and is named against the field. `sourceMediaType` and
     `sourceProvenance` have this answer today, in
     `run/a-photograph-reaches-the-model-as-a-photograph`. That proof runs the shipped provider over
     a transport that records rather than calls a vendor, so it costs nothing.

   A fake that re-implements the shipped rule, for example by refusing a photograph without a
   provenance, is not a third answer. It is a second copy of the rule, and the two would drift.

3. **`protections/a-fake-cannot-hide-a-missing-field` holds this mechanically.** It finds every
   field that meets the three conditions: optional on a seam input, read by a shipped
   implementation, and ignored by a fake. It requires the set to equal a table that names each
   field's proof, member by member and in both directions (ADR-0029). A new field with neither
   answer is red by name, with both remedies in the message. An entry whose field stopped matching
   is red too, so the table cannot claim a guard that has gone. A fake is an implementation in a
   file named `fake-*`, the convention `src/pipeline/fake-providers.ts` set. That set is itself
   asserted by name.

4. **What the guard does not see is stated in it.** It follows an input into functions whose body
   the program holds. It does not follow one through a spread, or into a method of another
   interface. It compares readers, not behaviour, so a fake that reads a field and discards it
   counts as reading it. The review question in point 1 covers what the scan cannot.

This record does not make `sourceProvenance` required. ADR-0019 chose an absent provenance to fail
closed to the verified path, and whether every caller can state it is a question about the product
seam, not about proofs. The named proof answers it until that is decided.

## Evidence

Each condition the scan decides on is killed by a planted wrong implementation, through
`tests/protections/mutation.ts`, at the fixture proof named for it: 11 of 11.

The scan's breadth is held the same way, by plants that narrow it to what the tree holds today:
only `sourceMediaType` and `sourceProvenance`, only `CaptureProvider`, only `capture`, only
`CaptureContext`, only `fake-providers.ts`, only literals that initialise a variable, only
literals a function returns, only method declarations, only the second parameter, only the last
parameter. All ten are red. The last two survived until a fixture put the input first, because
both seams in the tree take their context second and last.

Against the tree:

- A new optional `CaptureContext.sourceLanguage`, read by the shipped provider, is red. It is named
  as an unanswered blind spot with both remedies.
- The fake reading `sourceProvenance` (and, separately, both fields) is red at the table's
  second assertion. The entry no longer matches.
- The photo route omitting `sourceProvenance` is red at three cases of the named proof. Omitting
  `sourceMediaType` is red at one: `expected 'image/jpeg' to be 'image/png'`.

Two conditions in the first draft of the scan survived their plants. Those were the requirement
that a seam interface declare a method, and that the interfaces and files it reads lie under
`src/`. Each was removed rather than kept as a condition nothing decides on.

## Consequences

### Positive

- The #104 shape can no longer arrive silently through a new field. The next optional input that a
  shipped implementation reads and the fake ignores stops the build and names its two ways out.
- The review has the question in words, for what the scan cannot see: a forwarder, a behaviour
  the fake discards, a double outside `fake-*`.

### Negative

- **The guard needs the type checker, not only the parser.** Which interface an object literal
  implements is its contextual type, and nothing in the literal's text says so. ADR-0028 pins
  TypeScript to `5.x` until a stable public compiler API exists, and lists the parser, visitor,
  preprocessor, position lookup and node predicates as the surface its guards use. This guard adds
  `createProgram` and the checker to that surface. The revisit condition there has to include them.
- It builds a program over `src/` on every run, which costs about 0.7 s.
- The table moves with the seams, which is its purpose. A red here is a question to answer, not a
  number to update.

## Alternatives considered

- **Require every implementation to read every optional field.** Rejected. It would flag the ten
  test doubles and the deterministic JSON-LD capture, none of which decides anything on the
  context. It would also be satisfied by a fake that reads a field and ignores it.
- **Make every optional seam field required.** This is the stronger answer where it fits, and point
  2 prefers it. As a blanket rule it decides product questions, such as ADR-0019's fail-closed
  absence, from a test guard.
- **Grep for callers that build a `CaptureContext` without the field.** Rejected. It covers one
  seam and one field, and it is exactly the kind of guard that is aimed and not broad.
