#!/usr/bin/env python3
"""Record Bring's parser output for every observation page and pin it as a fixture.

Bring resolves a recipe import by redirecting to a deeplink whose payload is
`https://api.getbring.com/rest/bringrecipes/parser?url=<recipe url>`. That endpoint
fetches the recipe URL server-side and returns Bring's own parse, which is what these
fixtures pin: a later Bring change makes them fail loudly.

Usage: python3 spikes/bring-compat/record.py [--sha <commit>]
"""
import argparse
import base64
import json
import pathlib
import subprocess
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
PARSER = "https://api.getbring.com/rest/bringrecipes/parser"
DEEPLINK = "https://api.getbring.com/rest/bringrecipes/deeplink"
RAW = "https://raw.githubusercontent.com/kschlt/cookframe"

# fixture id -> list of (case name, page path or absolute url, extra parser params)
# Filled in by hand from spikes/bring-compat/protocol.md — the questions that live in
# the Bring app rather than in its HTTP traffic.
DEVICE_PLACEHOLDER = "UNOBSERVED — see spikes/bring-compat/protocol.md"

CASES = {
    "ingredient-parsing": [
        ("baseline", "baseline.html", {}),
        ("line-shapes", "ingredient-parsing.html", {}),
    ],
    "missing-author": [
        ("author-absent", "missing-author.html", {}),
        ("author-empty-string", "empty-author.html", {}),
        ("author-present-control", "baseline.html", {}),
    ],
    "quantity-classes": [
        ("exact", "quantity-exact.html", {}),
        ("vague", "quantity-vague.html", {}),
        ("ranged", "quantity-ranged.html", {}),
    ],
    "multi-yield-scaling": [
        ("multiple-yields", "multi-yield.html", {}),
        ("no-yield", "no-yield.html", {}),
        ("yield-bare-number", "yield-bare-number.html", {}),
        ("baseline-requested-8", "baseline.html", {"requestedQuantity": "8"}),
        ("baseline-requested-2", "baseline.html", {"requestedQuantity": "2"}),
        ("baseline-base-2-requested-8", "baseline.html",
         {"baseQuantity": "2", "requestedQuantity": "8"}),
        ("multi-yield-requested-8", "multi-yield.html", {"requestedQuantity": "8"}),
    ],
    "no-image": [
        ("image-absent", "no-image.html", {}),
        ("image-url-404", "broken-image.html", {}),
        # control: baseline carries a resolvable image pinned to its commit
        ("image-present-control", "baseline.html", {}),
    ],
    "tokenized-url": [
        ("unguessable-path", "t/9f2c7ae4b1d04c6f8e3a5b7c9d1e2f30/recipe.html", {}),
        ("unguessable-path-plus-query-token",
         "t/9f2c7ae4b1d04c6f8e3a5b7c9d1e2f30/recipe.html?token=s3-observation-token", {}),
    ],
    "url-reachability": [
        # absolute URLs: the premise behind OQ-05
        ("private-repo-raw",
         f"{RAW.replace('/cookframe', '/cookframe-aos')}/main/README.md", {}),
        ("http-scheme", "http://raw.githubusercontent.com/kschlt/cookframe/"
                        "{sha}/spikes/bring-compat/pages/baseline.html", {}),
        ("loopback", "https://127.0.0.1/recipe.html", {}),
        ("private-network", "http://10.0.0.1/recipe.html", {}),
        ("nonexistent-host", "https://cookframe-s3-does-not-exist.example/recipe.html", {}),
        ("path-404", "{base}/spikes/bring-compat/pages/does-not-exist.html", {}),
    ],
}


def url_for(sha, page):
    if page.startswith("http"):
        return page.format(sha=sha, base=f"{RAW}/{sha}")
    return f"{RAW}/{sha}/spikes/bring-compat/pages/{page}"


def get(url, params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{q}", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.headers.get("content-type", ""), r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read().decode("utf-8")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def head_only(url, params):
    """Return (status, Location) without following the redirect."""
    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}")
    try:
        with opener.open(req, timeout=60) as r:
            return r.status, r.headers.get("location")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("location")


def body(text):
    try:
        return json.loads(text)
    except ValueError:
        return text.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sha", default=subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=HERE.parent.parent).decode().strip())
    args = ap.parse_args()
    FIXTURES.mkdir(exist_ok=True)

    for fid, cases in CASES.items():
        out = {
            "fixture": f"bring-compat/{fid}",
            "item": "CFV1-S3",
            "endpoint": PARSER,
            "pages_pinned_at": args.sha,
            "observations": [],
        }
        for name, page, extra in cases:
            src = url_for(args.sha, page)
            params = {"url": src}
            params.update(extra)
            status, ctype, text = get(PARSER, params)
            out["observations"].append({
                "case": name,
                "source_url": src,
                "parser_params": extra,
                "http_status": status,
                "content_type": ctype,
                "response": body(text),
            })
            print(f"{fid}/{name}: {status}")
        (FIXTURES / f"{fid}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # The deeplink the app actually opens. Recorded without following the redirect:
    # the Location header is the observable, and its `src` payload is what a share
    # would carry.
    share = {
        "fixture": "bring-compat/share-propagation",
        "item": "CFV1-S3",
        "endpoint": DEEPLINK,
        "pages_pinned_at": args.sha,
        "observations": [],
        "device_observations": DEVICE_PLACEHOLDER,
    }
    for name, page in [("baseline", "baseline.html"),
                       ("capability-url",
                        "t/9f2c7ae4b1d04c6f8e3a5b7c9d1e2f30/recipe.html")]:
        src = url_for(args.sha, page)
        status, location = head_only(DEEPLINK, {"url": src, "source": "web"})
        decoded = None
        if location:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
            raw_src = q.get("src", [None])[0]
            if raw_src:
                pad = "=" * (-len(raw_src) % 4)
                decoded = base64.b64decode(raw_src + pad).decode("utf-8", "replace")
        share["observations"].append({
            "case": name,
            "source_url": src,
            "http_status": status,
            "location": location,
            "decoded_src": decoded,
            "source_url_recoverable_from_share_link": bool(decoded and src in decoded),
        })
        print(f"share-propagation/{name}: {status}")
    (FIXTURES / "share-propagation.json").write_text(
        json.dumps(share, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
