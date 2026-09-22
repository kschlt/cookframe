# The mobile capture entry point

`Capture Recipe.plist` is Cookframe's mobile client. It photographs a recipe page and submits it to
your instance, so capture starts on the phone rather than by opening the application first.

`PDR-0003` decides that **this file is the source of truth**. A hosted share link may mirror it for
convenience; the mirror is never the only copy and never the authoritative one, and where the two
disagree this file is right. That is what makes the mobile client auditable like the rest of the
product: it arrives by pull request and it is versioned with the code it talks to.

## What it does not contain

No credential, and no identifier of any instance. The two values it needs are asked for **when you
import it** and stored only in your own copy on your own device:

- the base URL of your instance
- its **instance-scoped ingest credential**

`cookframe.example` appears as a placeholder. `example` is a reserved domain (RFC 2606): it resolves
nowhere and names nobody's instance.

## What the credential is, and is not

It authenticates one thing: submitting a capture to one instance. It is **not** a model-provider
credential, it **cannot be exchanged** for one, and it reaches **no part of your library** — there is
no read route on the ingest endpoint and no listing. Losing the phone costs submission to that
instance until you rotate the credential. It costs neither your recipes nor your model account.

That boundary is `PDR-0001`'s eighth invariant and `PDR-0003`'s decision, and it is proved rather
than promised: see `tests/slice5/`.

## Setting it up

1. **Generate a credential** on the machine running your instance, and configure the instance with
   it. Any 32-character-or-longer random string; the instance refuses a shorter one at startup:

   ```
   node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'
   ```

2. **Transfer `Capture Recipe.plist` to the phone** — AirDrop, iCloud Drive, or any file transfer.

3. **Import it.** Shortcuts asks the two questions above as you import; answer them with your base
   URL and the credential from step 1. An unsigned shortcut needs *Settings → Shortcuts → Allow
   Untrusted Shortcuts* enabled once.

4. **Run it.** It opens the camera, you photograph the page, and it shows what came back.

Add it to the Home Screen or to the Action button if you want it one tap away. That is a convenience,
not a requirement.

## What you will see

- **Imported.** The recipe's title, so you know which one landed.
- **Not imported.** The refusal in its own words. The one you are most likely to meet is a page that
  holds several recipes: it is refused rather than truncated to one, and the message tells you how
  many were found and what they were called, so you can photograph one of them on its own.

  That refusal exists because the alternative is worse than an error. The first real-photograph run
  put a magazine spread carrying four recipes through the pipeline and got one back — nothing wrong
  in the output, so nothing looked wrong, and the only evidence of the loss was the page the user no
  longer had in front of them.

## What has not been verified here

The definition parses as a property list and its actions are the documented Shortcuts action
identifiers, and both are checked by `tests/slice5/shortcut-definition-committed-and-clean`.

**It has not been imported on a device from this repository.** No iOS device is reachable from the
environment this was built in, so "Shortcuts accepts this file and the flow runs" is an operator
step, recorded as `OQ-38` rather than claimed here. If it fails on import, that is a bug in
this file and worth an issue: a client nobody can install is the failure mode `PDR-0003` was written
to avoid.
