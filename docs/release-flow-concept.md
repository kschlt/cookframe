# Konzept: Changelog und Release-Flow

Status: Entscheidungsvorlage, nichts davon ist eingeschaltet. Entscheiden muss Kornelius; wird ein
Punkt angenommen, entsteht daraus ein ADR (Entwurf unten) und ein eigener Bau-PR.

## Ausgangslage

- Keine Tags, kein Changelog, `package.json` steht auf `0.0.0` (`private: true`).
- `deploy.yml` (#131) startet bei `release: published`, checkt `tag_name` aus, wartet auf die
  Freigabe im Environment `production` und läuft `flyctl deploy --remote-only`. Das Release ist also
  der Deploy-Auslöser; Tests laufen dort nicht noch einmal, `main` ist per Branch-Schutz grün.
- Jeder Commit und jeder PR-Titel ist ein Conventional Commit (CI-Job `commits`, ADR-0031), und die
  Merge-Commits auf `main` tragen den PR-Titel. `git log --first-parent main` ist damit schon eine
  saubere Liste von Änderungen mit PR-Nummer.
- Das Repository ist öffentlich, Actions-Minuten kosten nichts. Es geht also um Wartezeit und
  Einfachheit, nicht um Geld.

## Was aos selbst tut (Vorbild, nicht Abhängigkeit)

aos schneidet Releases, schreibt sie nicht: `release.py cut` leitet den nächsten
`CHANGELOG.md`-Abschnitt aus den Work-Log-Einträgen ab, die Nummer folgt der höchsten deklarierten
`release_impact` (`none`/`patch`/`minor`/`major`), der Schnitt ist ein PR (`chore(release): vX.Y.Z`),
und ein Workflow `release-tag` setzt nach grünem CI den Tag und legt das GitHub-Release mit dem
Abschnitt als Text an. Eine Sitzung pusht nie einen Tag. Diese Prinzipien gelten auch hier.

Direkt übernehmen kann Cookframe das nicht: `uses_release_step` in `.aos/config.json` steht auf
`false`, und das Produkt darf nicht von der privaten Maschinerie abhängen (CLAUDE.md). Außerdem gibt
es in Cookframe kein `release_impact` pro Item, wohl aber Conventional Commits. Andere aos-Konsumenten
mit eigenem Release-Fluss habe ich nicht gefunden; das Vergleichsbild sind die gängigen
Werkzeuge (GitHub-generierte Notes, release-please, git-cliff, Changesets), aus meinem Wissen und
nicht frisch nachgeprüft.

## Entscheidungen

### 1. Versionsquelle

| Option | Für | Gegen |
| --- | --- | --- |
| **A. Der Git-Tag ist die Wahrheit, `package.json` bleibt `0.0.0`** | Eine Quelle, kein Bump-Commit, `deploy.yml` passt schon (checkt den Tag aus) | Im laufenden Code ist die Version nicht sichtbar |
| B. `package.json` wird im Release-PR gebumpt, Tag muss passen | Version im Code lesbar | Zwei Quellen, ein Drift-Test nötig, der Pakettyp ist `private` und wird nie veröffentlicht |
| C. Version zur Laufzeit aus Tag/Commit (Build-Arg) | Nützlich für Support | Berührt `Dockerfile` und `fly.toml`, eigener PR |

**Empfehlung A.** C ist ein späterer, getrennter Wunsch (die Instanz meldet ihren Commit), kein
Teil dieses Konzepts.

### 2. Tag-Schema

`vMAJOR.MINOR.PATCH` (SemVer, mit `v`). Bis V1 gilt `0.y.z`: `y` für Neues oder jede Änderung, die
ein Betreiber beachten muss (Migration, neue Pflicht-Variable), `z` für Korrekturen. Das erste
Release ist `v0.1.0`. `1.0.0` wird erst vergeben, wenn V1 ausgerufen ist; das ist ein
Produkt-Entscheid und hier nicht getroffen. Keine Vorab-Tags (`-rc`), kein Kalender-Schema.

### 3. Release Notes erzeugen

| Option | Für | Gegen |
| --- | --- | --- |
| A. GitHub „Generate release notes" (+ `.github/release.yml`) | Null Code, null Minuten | Kein `CHANGELOG.md` im Repo, nur auf GitHub; Gruppierung hängt an PR-Labels, die es nicht gibt |
| **B. `CHANGELOG.md` im Repo, aus den Conventional-Commit-Titeln auf `main` erzeugt** (kleines Skript ohne Abhängigkeit, im Release-PR) | Im Repo und damit für Agenten und Selbst-Hoster lesbar, versioniert, offline, genau aos' „geschnitten, nicht geschrieben" | Ein Skript (~80 Zeilen) und ein Test sind zu pflegen |
| C. release-please oder git-cliff als Action | Fertig | Fremde Action mit Schreibrechten, mehr Konfiguration als der Nutzen bei einem Betreiber, bei release-please ein Lauf pro Push auf `main` |

**Empfehlung B.** Die Eingabe (`git log --first-parent <letzter Tag>..HEAD`) ist dank ADR-0031
schon sauber, also braucht es keine Bibliothek. Das Skript sortiert nach Typ:
`feat` unter *Added*, `fix` und `perf` unter *Fixed*, `!` oder `BREAKING CHANGE` unter *Breaking*,
`docs`/`test`/`ci`/`chore`/`build` unter *Internal* (Dependabot-Bumps nur als Zahl). Dazu ein
eigener Abschnitt **Upgrade** für Selbst-Hoster, ausgelöst durch Änderungen an `migrations/`,
`.env.example` oder `fly.toml`, weil nur das einen Betreiber zum Handeln zwingt. Der Titel
„Internal" ist leerer Lärm und wird im Release-Text eingeklappt.

### 4. Ablauf (Empfehlung)

1. Eine Person oder ein Agent führt `node scripts/release-notes.mjs` aus; das schreibt den neuen
   Abschnitt in `CHANGELOG.md`, die Nummer schlägt es aus den Typen vor (Mensch bestätigt).
2. PR `chore(release): v0.1.0` mit nur dieser Änderung, normales CI, normaler Review.
3. Nach dem Merge legt ein kleiner Workflow `release-draft.yml` (`on: push` auf `main`,
   `paths: [CHANGELOG.md]`, `contents: write`, ca. 15 Sekunden) ein **Entwurfs-Release** an:
   Tag `v0.1.0` auf dem Merge-Commit, Text = der Abschnitt. Ein Entwurf löst `deploy.yml` nicht aus.
4. Kornelius prüft den Entwurf und drückt **Publish**. Das ist die einzige Freigabe-Handlung für
   das Release; `deploy.yml` startet, wartet auf die Freigabe im Environment `production`, deployt.

Warum so: Tag und Deploy bleiben bei einem Menschen (Sitzungen dürfen keine Tags pushen, der Deploy
bleibt hinter einem Reviewer), `ci.yml` bleibt frei von Schreibrechten und Secrets
(`slice0/no-deploy-from-fork-prs` bleibt wahr), und es entsteht kein Lauf pro normalem Push: der
Entwurfs-Workflow startet nur, wenn `CHANGELOG.md` sich ändert. Kosten pro Release: ein
Entwurfslauf von Sekunden plus der schon bestehende Deploy.

Eine Variante ohne den Entwurfs-Workflow ist möglich (Kornelius legt Tag und Release in der
GitHub-Oberfläche an und fügt den Text ein). Sie spart eine Datei, kostet aber jedes Mal einen
Kopierschritt und erlaubt, dass Tag und Changelog auseinanderlaufen.

### 5. Absicherung (klein halten)

- Ein Test in `tests/unit/`: der oberste Abschnitt von `CHANGELOG.md` ist eine gültige,
  größere SemVer-Zahl als der darunter, das Datum ist ISO.
- Ein Test pinnt `release-draft.yml` (nur `CHANGELOG.md`-Pfad, `contents: write` nur dort, kein
  `pull_request`-Auslöser), im Stil von `ci/commits-job-checks-the-pull-request`.
- Keine Änderung der Jobnamen in `ci.yml` (Branch-Schutz hängt daran).

## Noch offen, für Kornelius

1. Versionsquelle A, Tag-Schema wie beschrieben, Notes B, Ablauf mit Entwurfs-Release: so
   einverstanden, oder eine andere Zeile?
2. Wann kommt `v0.1.0`? Der erste Lauf prüft zugleich `deploy.yml` und das Fly-Setup gegen die
   Wirklichkeit (steht als offener Punkt im Fly-Erfahrungsbericht).
3. Soll `1.0.0` an „V1 ausgerufen" hängen? (Produkt-Entscheid, evtl. eigenes PDR.)

## ADR-Entwurf (zur Aufnahme, wenn angenommen)

Nummer vergibt der Review-Thread. Auf `main` ist `ADR-0034` die höchste; die PDR-Nummern 0007 bis
0009 liegen in #134, `PDR-0010` ist belegt. Dieser Entwurf braucht **kein PDR**, solange die
1.0-Frage (Punkt 3) offen bleibt.

> **ADR-00NN — Ein Release ist ein Tag auf `main`, sein Text ein aus den Commit-Titeln
> geschnittener Changelog-Abschnitt, und veröffentlichen heißt deployen.**
> Kontext: siehe oben. Entscheidung: Versionsquelle ist der Tag (`vX.Y.Z`, `0.y.z` bis V1);
> `CHANGELOG.md` wird von `scripts/release-notes.mjs` aus `git log --first-parent` erzeugt, nie von
> Hand geschrieben; ein Release-PR trägt den Schnitt; `release-draft.yml` legt nach dessen Merge
> einen Entwurf an; der Mensch veröffentlicht, `deploy.yml` deployt hinter dem Reviewer.
> Folgen: eine Datei und ein Workflow mehr; die Release-Wahl bleibt eine Handlung der Person, die
> auch den Deploy freigibt. Falsifikator: ein zweiter Betreiber oder ein Paket-Register, das eine
> Version im Code verlangt, dann wird A durch B abgelöst (neuer ADR, nicht Umschreiben).
