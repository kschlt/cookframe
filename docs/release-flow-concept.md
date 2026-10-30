# Konzept: Changelog und Release-Flow

Status: Die Richtung ist von Kornelius angenommen (30.10.2026). Eingeschaltet ist nichts; daraus
entstehen ein ADR (Entwurf unten) und ein eigenes Bau-Item. Offen sind noch das
Pre-Release-Etikett und der Zeitpunkt von `v0.1.0`.

## Ausgangslage

- Keine Tags, kein Changelog, `package.json` steht auf `0.0.0` (`private: true`).
- `deploy.yml` (#131) startet bei `release: published`, checkt `tag_name` aus, wartet auf die
  Freigabe im Environment `production` und deployt mit `flyctl deploy --remote-only`. Tests laufen
  dort nicht noch einmal, weil `main` per Branch-Schutz grün ist.
- Jeder Commit und jeder PR-Titel ist ein Conventional Commit (CI-Job `commits`, ADR-0031).
- Das Repository ist öffentlich, Actions-Minuten kosten nichts. Es geht also um Wartezeit und
  Einfachheit, nicht um Geld.

## Wie es die anderen machen (gelesen am 30.10.2026)

| | aos | collibra-agent (+ collibra-agent-aos) |
| --- | --- | --- |
| Leser der Notes | Konsumenten der Maschinerie | Nutzer des Produkts |
| Quelle der Notes | aus den Work-Log-Einträgen abgeleitet (`release.py cut`), nie von Hand | pro Version eine Datei `docs/release-notes/<version>.md`, von der Sitzung geschrieben, mit festen Regeln für Leser und Gruppen |
| `CHANGELOG.md` | geschnittener Abschnitt | aus den Notes-Dateien generiert, `changelog.py check` hält ihn frisch |
| Versionsmarke | neuester Abschnitt in `CHANGELOG.md` | `version` in `core/manifest.json`, mit dem Plugin-Manifest abgeglichen |
| Nummer | aus `release_impact` pro Item | schlägt die Sitzung vor, bestätigt der Owner |
| Wo der Schnitt passiert | im Bau-PR, der den Release fällig macht (`release_step.py`, seit 29.10.: 96 Release-Items in 23 Tagen waren zu viel) | eigener Release-PR als eigenes Item (`REL`, `REL-21`, `REL-31`, `REL-42`) |
| Tag und GitHub-Release | CI nach grünem Lauf auf `main`; ein `release`-Job in `ci.yml`, der nur startet, wenn ein neuer Abschnitt kam | Workflow `release-tag` per `workflow_run` nach `product-ci` auf `main` |
| Vor 1.0 | erstes Release war `v1.0.0` | `0.y.z`, Release als Pre-Release markiert |
| Was danach kommt | nichts | eine Zertifizierung gegen eine echte Umgebung, vom Owner angestoßen; sie begrenzt nur die Aussagen der Statusseite, hält kein Release zurück |

In beiden gilt: Eine Sitzung bereitet vor und pusht nie einen Tag. Der Tag ist ein einfacher Tag
auf dem Commit, der die Version gebracht hat, und wird nie verschoben oder neu gesetzt. Ein
bestehendes GitHub-Release wird nie überschrieben. Eine Lektion aus `REL-42` gilt auch hier:
*Known limits* aus den letzten Notes werden mitgenommen, solange das Release sie nicht behebt.

## Was Cookframe übernimmt

Cookframe ähnelt collibra-agent, nicht aos: ein Produkt mit Nutzern und Selbst-Hostern, wenige
Releases, mehrere Threads arbeiten parallel. Deshalb:

1. **Notes für Leser, nicht aus Commit-Titeln.** Pro Version `docs/release-notes/<version>.md`, auf
   Englisch wie das übrige Repo. Gruppen in fester Reihenfolge nach Keep a Changelog: *Added,
   Changed, Deprecated, Removed, Fixed, Security*, leere Gruppen fallen weg. *Deprecated* nennt,
   was noch geht, aber in einer späteren Version wegfällt, und was stattdessen zu nutzen ist. Dazu zuerst **Action needed** für Betreiber (Migration, neue oder geänderte Variable,
   `fly.toml`) und zuletzt **Known limits**. Jeder Eintrag beschreibt in ein bis zwei Sätzen die
   Wirkung. Item-IDs, ADR-Nummern und reine Bau- oder Testarbeit kommen nicht hinein. Die
   Merge-Commits seit dem letzten Tag (`git log --first-parent`) sind die Arbeitsliste, nicht der
   Text.
2. **`CHANGELOG.md` wird aus den Notes generiert**, und ein Test schlägt fehl, wenn die Datei
   veraltet ist.
3. **Eine Versionsmarke: `version` in `package.json`.** Ein Test prüft, dass sie eine
   Release-Nummer ist und dass es Notes für sie gibt. Damit kennt auch der laufende Code seine
   Version, falls sie später angezeigt werden soll.
4. **Eigener Release-PR als eigenes Item**, `chore(release): v0.1.0`: Marke, Notes, Changelog. Die
   Sitzung wählt die Nummer nach den Regeln in Punkt 6, der Review prüft sie mit. Bau-PRs fassen nichts davon an, also
   gibt es keine Konflikte zwischen parallelen Threads. Der aos-Weg (Schnitt im Bau-PR) lohnt sich
   erst bei vielen Releases am Tag.
5. **Tag und Release macht CI**, wie in beiden Vorbildern: ein Workflow `release.yml` startet per
   `workflow_run`, wenn `CI` auf einem Push nach `main` grün endet. Er sucht den
   First-Parent-Commit, der die aktuelle Marke gebracht hat, setzt `v<version>`, falls es den Tag
   noch nicht gibt, und legt das GitHub-Release mit der Notes-Datei als Text an (ob als
   Pre-Release, ist noch offen, siehe unten). Bei jedem anderen Push endet er nach Sekunden ohne Wirkung.
   `ci.yml` bleibt ohne Schreibrechte und ohne Deploy (`slice0/no-deploy-from-fork-prs`).
6. **Semver mit `0.y.z` bis V1**: ein Fix erhöht `z`; Neues oder eine Änderung, auf die ein Betreiber
   reagieren muss, erhöht `y`. Das erste Release ist `v0.1.0`. Wann `1.0.0` kommt, ist ein
   Produkt-Entscheid und hier nicht getroffen.

   **Was `0.y.z` bedeutet:** Die Schnittstelle ist noch nicht stabil. Das ist keine Aussage
   darüber, ob das Produkt fertig oder brauchbar ist. Nach SemVer darf sich vor `1.0.0` die
   öffentliche Schnittstelle zwischen Minor-Versionen ändern. Bei Cookframe sind das die HTTP-Routen,
   der Vertrag mit dem iOS-Shortcut, die Konfigurationsvariablen, das Datenbankschema samt
   Migrationen und das Format des Canonical Recipe. `1.0.0` verspricht, dass sich davon nichts mehr
   ohne neue Major-Version bricht. Die Notes sagen es in einem Satz im Kopf von `CHANGELOG.md`.

7. **Zurückgezogene Releases (*yanked*), nach Keep a Changelog.** Ein Release wird zurückgezogen,
   wenn es nicht betrieben werden soll, etwa wegen eines Datenverlusts oder einer Sicherheitslücke.
   Der Tag bleibt stehen, denn ein Tag wird nie gelöscht oder verschoben. Ein Release-PR setzt
   hinter die Überschrift der Notes-Datei `[YANKED]`, fügt einen Satz mit Grund und Ersatzversion
   hinzu und generiert den Changelog neu. Im selben PR oder kurz danach kommt das Fix-Release,
   das den Deploy ersetzt. Den Text des bestehenden GitHub-Releases passt Kornelius von Hand an,
   weil der Workflow ein bestehendes Release nie bearbeitet.

## Was bei uns anders sein muss

**Das Release ist der Deploy-Auslöser, und genau das bricht, wenn man die Vorbilder kopiert.** Ein
Release, das ein Workflow mit dem `GITHUB_TOKEN` anlegt, startet keine weiteren Workflows (GitHub
Docs, *Events that trigger workflows*: Ereignisse des `GITHUB_TOKEN` erzeugen keine Läufe, außer
`workflow_dispatch` und `repository_dispatch`). `deploy.yml` auf `release: published` würde also
nie anspringen. Lösung: `deploy.yml` bekommt zusätzlich `on: workflow_call`, und `release.yml` ruft
es nach dem Anlegen des Releases als Job auf. Die Freigabe im Environment `production` bleibt das
Tor, nur an anderer Stelle. Der bisherige Auslöser bleibt für ein von Hand angelegtes Release bestehen.

**Wer was tut** (entschieden von Kornelius am 30.10.2026):

| Schritt | Wer |
| --- | --- |
| Release-Item anlegen, Notes schreiben, Nummer wählen, PR öffnen | eine Sitzung |
| Review und Merge des Release-PR | das Merge-Gate (`merge_authority: gated`), wie bei jedem anderen PR |
| Tag setzen, GitHub-Release anlegen, Deploy-Job starten | `release.yml`, nach grünem CI auf `main` |
| Deploy in `production` freigeben | **Kornelius**, das ist sein einziger Schritt |
| Text eines bestehenden GitHub-Releases ändern (etwa bei *yanked*) | Kornelius von Hand |

**Der Deploy ist unsere „Zertifizierung“.** Wie bei collibra-agent hält er kein Release zurück: Das
Release existiert, sobald CI grün ist. Schlägt der Deploy fehl, bleibt die alte Version auf Fly
(der `release_command` bricht vorher ab), und das Problem wird ein Fix-Release. Einen Rückzug von
Tags gibt es nicht.

**Keine aos-Abhängigkeit im Produkt.** Die Skripte liegen in Cookframe selbst (TypeScript,
ohne neue Abhängigkeit), getestet mit vitest, so wie collibra-agent `delivery/` mitbringt.
`uses_release_step` in `.aos/config.json` bleibt `false`.

## Was zu bauen wäre (ein Item, Umfang zur Einschätzung)

- `scripts/release.ts` mit `target`, `tag`, `notes`, `prerelease`, `changelog`, `unreleased`
  (Vorbild `delivery/release_tag.py` und `delivery/changelog.py`), jeweils mit festen Exit-Codes:
  0 tun, 1 nichts zu tun, 2 Fehler.
- `.github/workflows/release.yml` (`workflow_run` auf `CI`, `contents: write`) und
  `workflow_call` in `deploy.yml`.
- `docs/release.md`: Ablauf für Sitzung und Owner, mit den Regeln für die Notes.
- Tests: Changelog frisch, Marke und Notes passen zusammen, Workflow-Verdrahtung festgehalten.
  Jobnamen in `ci.yml` ändern sich nicht (Branch-Schutz hängt daran).

## Noch offen, für Kornelius

1. Bekommt ein `0.y.z`-Release auf GitHub das Pre-Release-Etikett? Dafür spricht collibra-agent;
   dagegen, dass GitHub dann kein Release als „Latest“ zeigt und das Etikett nach „unfertig“ klingt.
2. Wann kommt `v0.1.0`? Der erste Lauf misst zugleich `release.yml`, `deploy.yml` und die
   Einstellung, dass das Workflow-Token Inhalte schreiben darf.
3. Soll `1.0.0` an „V1 ausgerufen“ hängen? (Produkt-Entscheid, gegebenenfalls ein eigenes PDR.)

## ADR-Entwurf (zur Aufnahme, wenn angenommen)

Die Nummer vergibt der Review-Thread. Auf `main` ist `ADR-0034` die höchste; die PDR-Nummern 0007
bis 0009 liegen in #134, `PDR-0010` ist belegt. Ein PDR ist nicht nötig, solange Frage 3 offen ist.

> **ADR-00NN: Ein Release wird in einem eigenen PR vorbereitet, von CI getaggt und veröffentlicht,
> und der Release-Workflow ruft den Deploy auf.**
> Entscheidung: Die Versionsmarke ist `version` in `package.json` (`0.y.z` bis V1). Ein Release-PR
> trägt die Marke, `docs/release-notes/<version>.md` und den daraus generierten `CHANGELOG.md` und
> wird wie jeder PR vom Merge-Gate gemergt.
> Nach grünem CI auf `main` setzt `release.yml` den Tag `v<version>` auf den Commit, der die Marke
> brachte, legt das GitHub-Release mit den Notes an und ruft `deploy.yml` hinter der Freigabe von
> `production` auf; diese Freigabe ist der einzige Schritt des Owners. Kein Tag wird verschoben
> oder gelöscht, kein Release vom Workflow überschrieben; ein zurückgezogenes Release wird in
> seinen Notes als `[YANKED]` markiert.
> Folgen: zwei Workflows mit Schreib- beziehungsweise Deploy-Rechten außerhalb von `ci.yml`;
> Release-Notes sind Text für Leser und werden geprüft, nicht abgeleitet.
> Falsifikator: Wenn Releases so häufig werden, dass Release-PRs die Arbeit bremsen (in aos ab etwa
> vier am Tag), wechselt der Schnitt in die Bau-PRs, durch einen neuen ADR.
