#!/usr/bin/env python3
"""Generate the disposable observation pages for CFV1-S3.

Each page is a minimal HTML document carrying one schema.org Recipe as JSON-LD.
The pages are deliberately synthetic: no real recipe, no personal data, no real
photograph. Regenerate with `python3 spikes/bring-compat/make_pages.py`.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
PAGES = HERE / "pages"

IMAGE = ("https://raw.githubusercontent.com/kschlt/cookframe/main/"
         "spikes/bring-compat/pages/fixture-image.png")

STEPS = [
    {"@type": "HowToStep", "text": "Kartoffeln in Scheiben schneiden."},
    {"@type": "HowToStep", "text": "Mit Rahm und Knoblauch schichten."},
    {"@type": "HowToStep", "text": "45 Minuten bei 180 Grad backen."},
]

HTML = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>{title} — Cookframe Bring-Compat Fixture</title>
<script type="application/ld+json">
{jsonld}
</script>
</head>
<body>
<h1>{title}</h1>
<p>{note}</p>
<p>Wegwerfbare Beobachtungsseite fuer den Cookframe-Spike CFV1-S3. Kein echtes Rezept,
keine personenbezogenen Daten.</p>
</body>
</html>
"""


def page(path, title, note, recipe):
    body = {"@context": "https://schema.org", "@type": "Recipe"}
    body.update(recipe)
    out = PAGES / path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(HTML.format(
        title=title,
        note=note,
        jsonld=json.dumps(body, ensure_ascii=False, indent=2),
    ), encoding="utf-8")


def base(**over):
    r = {
        "name": "Kartoffelgratin",
        "author": {"@type": "Person", "name": "Cookframe Fixture"},
        "image": IMAGE,
        "recipeYield": "4 Portionen",
        "recipeIngredient": ["800 g Kartoffeln", "200 ml Rahm", "100 g Gruyere"],
        "recipeInstructions": STEPS,
    }
    r.update(over)
    for k in [k for k, v in r.items() if v is None]:
        del r[k]
    return r


# --- author: required versus tolerated -----------------------------------
page("missing-author.html", "Kartoffelgratin (ohne Autor)",
     "Autorfeld fehlt vollstaendig.",
     base(name="Kartoffelgratin (ohne Autor)", author=None))

page("empty-author.html", "Kartoffelgratin (leerer Autor)",
     "Autorfeld vorhanden, aber leer.",
     base(name="Kartoffelgratin (leerer Autor)",
          author={"@type": "Person", "name": ""}))

# --- ingredient parsing ---------------------------------------------------
page("ingredient-parsing.html", "Zutatenzerlegung",
     "Inventar an Zeilenformen, um Menge, Einheit und Name zu trennen.",
     base(name="Zutatenzerlegung", recipeIngredient=[
         "200 g Mehl",
         "250ml Milch",
         "1,5 l Wasser",
         "0.5 kg Zwiebeln",
         "1/2 TL Zucker",
         "½ TL Zimt",
         "2 Stück Eier",
         "3 EL Olivenöl, kaltgepresst",
         "Saft einer halben Zitrone",
         "100 g Butter (weich)",
         "Mehl zum Bestäuben",
         "2 Dosen à 400 g Tomaten",
         "1 Bund Petersilie, fein gehackt",
         "Salz und Pfeffer",
     ]))

# --- quantity classes -----------------------------------------------------
page("quantity-exact.html", "Mengen exakt",
     "Nur exakte Mengen mit Einheit.",
     base(name="Mengen exakt", recipeIngredient=[
         "200 g Mehl", "250 ml Milch", "3 EL Olivenöl", "2 Stück Eier", "1,5 l Wasser",
     ]))

page("quantity-vague.html", "Mengen vage",
     "Nur vage Mengenangaben ohne Zahl.",
     base(name="Mengen vage", recipeIngredient=[
         "etwas Salz", "eine Prise Muskat", "eine Handvoll Basilikum",
         "Pfeffer nach Geschmack", "Öl zum Braten", "Mehl",
     ]))

page("quantity-ranged.html", "Mengen als Bereich",
     "Nur Bereichsmengen, in vier Schreibweisen.",
     base(name="Mengen als Bereich", recipeIngredient=[
         "2-3 EL Olivenöl",
         "400–500 g Mehl",
         "1 bis 2 TL Senf",
         "2 - 3 Zwiebeln",
         "½–1 TL Zimt",
     ]))

# --- yields ---------------------------------------------------------------
page("multi-yield.html", "Mehrere Yields",
     "recipeYield als Liste, plus kontextuelle Yields im Fliesstext.",
     base(name="Mehrere Yields",
          recipeYield=["4 Portionen", "12 Muffins", "1 Blech"],
          description="Fuer 4 Personen als Hauptgang oder 8 als Beilage; ergibt 12 Muffins.",
          recipeIngredient=["800 g Kartoffeln", "200 ml Rahm", "100 g Gruyere"]))

page("no-yield.html", "Ohne Yield",
     "Kein recipeYield — zeigt, worauf Bring die Basismenge setzt.",
     base(name="Ohne Yield", recipeYield=None))

page("yield-bare-number.html", "Yield als blosse Zahl",
     "recipeYield ist die Zahl 6 ohne Einheit.",
     base(name="Yield als blosse Zahl", recipeYield="6"))

# --- image ----------------------------------------------------------------
page("no-image.html", "Ohne Bild",
     "Kein image-Feld.",
     base(name="Ohne Bild", image=None))

page("broken-image.html", "Bild-URL zeigt ins Leere",
     "image-Feld vorhanden, Ziel liefert 404.",
     base(name="Bild-URL zeigt ins Leere",
          image="https://raw.githubusercontent.com/kschlt/cookframe/main/"
                "spikes/bring-compat/pages/does-not-exist.png"))

# --- tokenized / capability URL ------------------------------------------
page("t/9f2c7ae4b1d04c6f8e3a5b7c9d1e2f30/recipe.html", "Capability-URL",
     "Erreichbar nur ueber einen nicht erratbaren Pfad — die Form einer Capability-URL.",
     base(name="Capability-URL"))

if __name__ == "__main__":
    print("wrote pages under", PAGES)
