# Is a publicly fetchable HTTPS URL genuinely required by Bring?

**Evidence for OQ-05 (hosting). This artifact supplies the observation the hosting decision
record consumes; it does not itself decide hosting (ADR-0001 / PDR-0002 leave OQ-05 open).**

## Finding — stated as an explicit yes/no

**YES. Bring requires the recipe to live at a URL that Bring's own servers can fetch over the
public internet. A URL only reachable from the user's device or network is not enough.**

Two sub-findings sharpen it:

1. **The fetch is server-side, from Bring's infrastructure — not from the phone.** Bring imports
   by calling `https://api.getbring.com/rest/bringrecipes/parser?url=<recipe url>`, and that
   endpoint fetches `<recipe url>` itself. So "reachable" means reachable *from Bring's servers*,
   not from the user's browser or LAN.

2. **HTTP (not only HTTPS) is accepted, but public reachability is mandatory.** An `http://`
   source parsed successfully in this run; the hard requirement is public reachability, and HTTPS
   is strongly advisable on every other ground (the capability URL is a bearer token — see the
   findings' Q6/Q7). Read the OQ-05 premise as "publicly fetchable" with HTTPS as the sensible
   default, not as "HTTPS specifically required by Bring".

## Observations behind it

Recorded in `fixtures/url-reachability.json`, parser endpoint, one call per case:

| Source URL class | Result | What it shows |
| --- | --- | --- |
| Public `https://raw.githubusercontent.com/...` (baseline) | **200, full parse** | a publicly fetchable page works |
| Same page over `http://` | **200, full parse** | scheme is not the gate; reachability is |
| Public URL, path that 404s | 400 "not reachable … httpStatus=404" | Bring reports the upstream status |
| **Private repo** raw URL (`cookframe-aos`, needs auth) | 400 "not reachable" | Bring's servers have no user credentials — a URL the user can see but Bring cannot is rejected |
| Loopback `https://127.0.0.1/...` | 403 (rejected at Bring's edge) | a device-local URL cannot be used |
| Private network `http://10.0.0.1/...` | 400 "connect timed out" | a LAN-only URL is unreachable from Bring |
| Nonexistent host | 400 "UnknownHostException" | must resolve on the public internet |

The private-repo case is the decisive one for hosting: the page exists and the *user* can read
it, but Bring's servers cannot, and the import fails. Whatever hosts the recipe for Bring must
serve it **unauthenticated to Bring's servers**.

## What this constrains for OQ-05 (without deciding it)

- The recipe representation Cookframe hands Bring must sit behind a **publicly resolvable,
  unauthenticated-to-Bring URL** for the duration of the import. A purely local instance with no
  public surface cannot drive a Bring import on its own.
- Because the URL is fetched by Bring's servers and retained by Bring as `linkOutUrl` (findings
  Q6), the public surface is also a **capability surface** — its secret belongs in the path, and
  OQ-17's token lifetime/revocation must assume Bring keeps the URL. This couples OQ-05 to OQ-17.
- The observation says nothing about *where* that public surface lives (a hosted relay, a
  tunnel, a per-import ephemeral URL, a push instead of a pull). That trade-off is OQ-05's to
  decide; this spike establishes only that some publicly-fetchable surface is unavoidable given
  Bring's pull-based, server-side import.

## Related observation: SSRF posture (informs S5, not OQ-05)

Bring itself rejects loopback and times out on RFC-1918 addresses when *it* is the fetcher —
evidence that Bring guards its own outbound fetch. Cookframe's own URL-ingestion side (S5,
ADR-0010) must do the same when *it* is the fetcher; the symmetry is worth carrying into that
suite. (No metadata-endpoint or further SSRF probing against Bring was performed — that would be
an attack on a third party, not observation.)
