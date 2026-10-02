# MyPhotos — relevé d'alignement

Maison lue jusqu'à : 24f561c (2026-10-02)

*Ouvert le 2026-10-02, à l'entrée du produit dans la maison. Aucun code applicatif
n'a été modifié ; seul le bloc de jetons généré a été posé. Les chemins `maison/…`,
`design/…`, `spec/…` désignent la racine de `LesDaguesHautes` ; les autres, la racine
de ce dépôt.*

## Les états

| État | Sens |
|---|---|
| *conforme* | déjà juste, ne se retouche pas |
| *fermé* `<commit>` | corrigé ; la ligne cite le commit |
| *remonté* `<ID>` | se décide ailleurs ; argumenté dans `docs/REMONTEES.md` |
| *différé — <session>* | tranché, attend une session nommée |
| *hors périmètre — <raison>* | |
| *à vérifier* | hypothèse, pas encore un constat |

## Comptes et foyer

Mécanisme choisi (`spec/01-comptes-et-foyer.md` § 3) : **B**.

## Le relevé

| Règle (`maison/01-REGLES.md`) | État | Preuve |
|---|---|---|
| § 4 Le bloc `DH:tokens` est posé et à jour | état: conforme | `python3 ../../tools/distribute.py --check MyPhotos` |
| § 4 Aucune couleur en dur hors du bloc | état: différé — session de rebranchage | `grep -rnoE '#[0-9a-fA-F]{6}\b' src/renderer --include='*.tsx' --include='*.ts' | wc -l` |
| § 2.5 Un foyer, une seule façon de le lire | état: différé — session comptes | `spec/01-comptes-et-foyer.md` § 11 |
| § 2.1 Local d'abord | état: conforme | `CLAUDE.md` § Règles produit non négociables |
| § 2.2 Aucune télémétrie | état: conforme | `grep -rliE "sentry\|analytics\|telemetry\|crashlytics"` : aucun SDK |
| § 2.3 Échanges extérieurs désactivés par défaut et nommés | état: remonté — point ouvert du registre | API Claude : désactivée par défaut (`CLAUDE.md`) ; mise à jour automatique : contacte GitHub sans réglage (`src/main/updater.ts`) |
| § 2.4 Export intégral en format ouvert | état: à vérifier | |
| § 2.6 Interface en français, code en anglais | état: à vérifier | |
| § 2.8 Commits en anglais | état: conforme | `git log --oneline -5` |

## Construire et tester

npm run typecheck && npm test
