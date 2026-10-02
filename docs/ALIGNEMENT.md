# MyPhotos — relevé d'alignement

Maison lue jusqu'à : 24cae9a (2026-10-02)

*Ouvert le 2026-10-02, à l'entrée du produit dans la maison. Le même jour, l'interface
a été alignée sur Brume (section *Direction artistique*) ; le comportement n'a pas
changé, sauf la barre d'outils qui passe en mode compact sous 1040 px au lieu de 900
pour laisser sa place à l'étiquette. Les chemins `maison/…`,
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
| § 4 Aucune couleur en dur hors du bloc | état: fermé 3fac021 | `grep -rnoE '#[0-9a-fA-F]{6}\b' src/renderer --include='*.tsx' --include='*.ts' | wc -l` → 0 le 2026-10-02 (21 avant). Restent en 3 chiffres : `#fff`/`#111` du texte sur la couleur d'un souvenir (`MemoryBook.tsx`, contenu) et `#000` du canevas de l'éditeur (`renderer.ts`, pixels). Valeurs propres hors marqueurs, chacune commentée : `src/renderer/src/styles.css:97-100,106` (`--heart`, `--stage`, `--stage-panel`, `--charcoal`) |
| § 2.5 Un foyer, une seule façon de le lire | état: différé — session comptes | `spec/01-comptes-et-foyer.md` § 11 |
| § 2.1 Local d'abord | état: conforme | `CLAUDE.md` § Règles produit non négociables |
| § 2.2 Aucune télémétrie | état: conforme | `grep -rliE "sentry\|analytics\|telemetry\|crashlytics"` : aucun SDK |
| § 2.3 Échanges extérieurs désactivés par défaut et nommés | état: remonté — point ouvert du registre | API Claude : désactivée par défaut (`CLAUDE.md`) ; mise à jour automatique : contacte GitHub sans réglage (`src/main/updater.ts`) |
| § 2.4 Export intégral en format ouvert | état: à vérifier | |
| § 2.6 Interface en français, code en anglais | état: à vérifier | |
| § 2.8 Commits en anglais | état: conforme | `git log --oneline -5` |

## Direction artistique — Brume

Source : `design/DIRECTION-ARTISTIQUE.md` § *Les règles* et § *Dans les apps* ;
valeurs : `design/tokens.json` v3. Vérifié à l'œil en jour et en nuit (Électron
hors écran sur le client web du serveur sans tête, `.devdata`) : photothèque,
souvenirs, lieux, nettoyage, favoris vide, réglages, visionneuse.

| Règle | État | Preuve |
|---|---|---|
| Couleurs : `--bg`, `--panel`, `--surface`, `--elevated`, `--fg`, `--muted`, `--faint`, `--line`, `--hover`, `--accent`, `--accent-soft` lisent `--dh-*` | état: fermé 3fac021 | `src/renderer/src/styles.css:82-107`. `--faint` = `--dh-muted` (pas de gris plus clair dans la maison sans passer sous 4,5:1) ; `--hover`, `--accent-soft`, `--tile` dérivés par `color-mix` |
| Règle 1 — l'étiquette sur les titres d'écran | état: fermé bfcd2e5 | `.etiquette` `src/renderer/src/styles.css:134` ; `Toolbar.tsx:108,120` (photothèque, sections, albums, personne, lieu, recherche), `PlacesPage.tsx:150`, `CleanupPage.tsx:28`, `PeoplePage.tsx:135`, `MemoriesPage.tsx:46`, `Welcome.tsx:41`. Minuscules par `text-transform`, les chaînes i18n ne changent pas. Aucun titre ne porte d'état en cours aujourd'hui : les « … » restent dans les lignes d'état (« Analyse en cours · … ») |
| Règle 2 — une couleur d'interface par écran | état: fermé 3fac021 | texte sur l'accent : `--on-accent` = `--dh-on-label` ; le vert du nettoyage, le bleu ciel des liens et des notifications, le rouge du badge d'album passent à l'accent (3fac021, 336bfc8). Restent hors accent, par sens : rouge des actions destructives (`red-500`), ambre de l'icône « disque débranché », rouge du cœur des favoris (`--heart`, symbole posé sur une photo) |
| Règle 3 — la texture dans le fond | état: fermé 3fac021 | `body, .brume` `src/renderer/src/styles.css:127` (tuile 512 px, `fixed`), nuit sous `:root.dark` ; la barre d'outils porte la même texture au lieu d'un flou. Jamais sur un texte ni une photo |
| Règle 4 — à plat, l'ombre seulement sous un objet dessiné | état: fermé 42481c8 | aucune ombre portée ni flou sous panneaux, popovers, dialogues, cartes, toasts : `grep -rn 'backdrop-blur' src/renderer --include='*.tsx'` → 0. Ombres restantes, toutes sur photo ou scène sombre : pastilles de vignettes, cadre de recadrage, pages du livre souvenir, marqueurs de carte. Ombre au fusain sous le globe : `components/Globe.tsx` |
| Règle 5 — le vide est une scène | état: fermé d09892d | le globe sur son ombre avec sa phrase : `Welcome.tsx:39`, `EmptySection.tsx:25`, `MemoriesPage.tsx:57`, `CleanupPage.tsx:152,221`. Le globe est une copie propre au produit de l'esquisse de la maison (`components/Globe.tsx`), à remplacer par la vraie illustration quand elle sera livrée |
| Règle 6 — chacun est un objet | état: différé — session comptes | MyPhotos n'affiche pas encore de membre du foyer ; les « Personnes » sont des visages reconnus dans les photos, pas des membres. S'appliquera avec `spec/01` (champ `objet`) |
| Pas de translucidité | état: fermé 42481c8 | `--panel` = `--dh-surface` opaque (`styles.css:84`) ; dialogues, menus, toasts, notice de mise à jour : `bg-elevated` opaque. Choix : les voiles derrière les dialogues (`bg-black/30–35`) restent, sans flou ; la visionneuse et les éditeurs gardent une scène quasi noire neutre (`--stage`) pour juger les couleurs des photos |
| Rayons | état: fermé 42481c8 | `--radius-card/sheet/pill/label` exposés à Tailwind (`styles.css:23-26`) : 3 px cartes, champs, lignes, menus ; feuille pour les dialogues ; pilule pour boutons, contrôles segmentés, recherche. Choix : les vignettes photo gardent leur arrondi (3 px dans la grille, déjà égal au jeton ; arrondi des couvertures de souvenirs et des miniatures conservé) |
| Typo — police système, deux graisses | état: fermé 76b1d91 | `grep -rn 'font-medium\|font-semibold' src/renderer --include='*.tsx'` → 0 ; boutons et ligne sélectionnée en gras |
| Mouvement — 160/220 ms, une courbe | état: fermé 76b1d91 | `--default-transition-duration` / `-timing-function` (`styles.css:29-30`), `animate-fade-in`/`pop-in` sur `--dh-motion-enter`. Exception gardée : `duration-75` de la pellicule de la visionneuse pendant le glissement (suit le pointeur) |

## Construire et tester

npm run typecheck && npm test
