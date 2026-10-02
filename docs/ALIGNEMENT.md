# MyPhotos — relevé d'alignement

Maison lue jusqu'à : c7654af (2026-10-02)

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

*Session comptes, 2026-10-02.* Le foyer est facultatif : sans lui, MyPhotos marche
comme avant. Les « Réglages » ont une section « Foyer » qui fait tout le parcours
seule ; le pré-réglage du lanceur n'est qu'une proposition. Vérifié par
`tests/household.test.ts` (9 tests, dossiers temporaires) et à l'œil, jour et nuit
(Électron hors écran, `.devdata`, dossier foyer temporaire) : proposition du
lanceur, « qui est là ? », nouveau membre, nouveau foyer, membre rattaché, page
invité avec « Je suis… » et têtes d'objet.

| Règle (`spec/01-comptes-et-foyer.md`) | État | Preuve |
|---|---|---|
| § 3.2 Mécanisme déclaré | état: conforme | ci-dessus : **B** |
| § 4 Fichiers écrits : `foyer.json` à la création, `membres/<id>/profil.json` du membre créé, `appareils/<device_id>.json` avec `app: "myphotos"` ; rien d'autre | état: fermé e08e644 | `src/core/household.ts:90-160` ; test « proposes the launcher member… » : le dossier foyer ne contient que `appareils`, `foyer.json`, `membres` |
| § 3.1 Un fichier, un écrivain ; écriture par fichier temporaire puis renommage | état: fermé e08e644 | `writeJsonAtomic` `src/core/household.ts` ; MyPhotos ne réécrit jamais `foyer.json` ni le profil d'un autre |
| § 3.4 Un `device_id` ne change jamais de membre | état: fermé e08e644 | `Household.join` `src/core/household.ts:249` : un autre membre reçoit un nouveau `device_id` ; quitter puis revenir comme le même membre garde le même (test) |
| § 4 État local dans `settings` : `member_id`, `foyer_dir`, `device_id` | état: fermé e08e644 | `src/core/household.ts` (`K`) ; s'y ajoutent, en cache, `foyer_name`, `foyer_members`, `foyer_seen_at` pour marcher dossier injoignable |
| § 5 Rattacher : choisir le dossier, « Créer le foyer » si `foyer.json` manque, « qui est là ? » / « Nouveau membre » (prénom + objet) | état: fermé 7760e19 | `src/renderer/src/features/settings/Household.tsx` ; dialogue natif par `window.desktop.pickFolder`, le reste par le serveur Hono (`/api/household*`, `src/server/app.ts`) |
| § 5 bis Pré-réglage lu, jamais écrit, jamais requis | état: fermé e08e644 | chemin passé par Electron (`app.getPath('appData')`, `src/main/index.ts:31`), `readPreset` `src/core/household.ts:165` ; « Continuer en tant que [Prénom] » seulement si le profil existe ; test « works without a household » |
| § 3.3 L'interface dit que le dossier foyer est lisible par qui y accède | état: fermé 7760e19 | `Privacy` dans `Household.tsx`, sous « qui est là ? » et « un nouveau foyer… » |
| § 5 Hors ligne : l'app marche et affiche la dernière lecture | état: fermé 7760e19 | « Dossier foyer injoignable. Dernière lecture le … » ; test « survives an unreachable folder » |
| § 6 Ignorer `._*` et `.DS_Store` | état: fermé e08e644 | `isNoise` `src/core/household.ts:42` ; test « ignores macOS doubles… » |
| § 6 Fichiers iCloud pas encore téléchargés | état: fermé e08e644 | `requestDownload` (macOS : `brctl download`, lu au passage suivant) |
| § 6 Relire toutes les 20 à 30 s | état: fermé e08e644 | `householdPoll` 30 s dans `Library.start` ; `last_seen` réécrit au démarrage |
| § 7, § 11 Migration 18 : `albums.owner_id`, `visibility` (défaut `perso`), `shared_with` (défaut `[]`), `share_comments.author_member_id`, `share_likes.author_member_id` | état: fermé e08e644 | `src/core/db/migrations.ts:331` ; test « migration 18 » sur une base en version 17 : données gardées, défauts posés |
| § 10 Les albums existants deviennent ceux du membre qui se rattache, perso ; `owner_name` devient le nom du profil | état: conforme — verdict `MYPHOTOS-02` tranché, source modifiée (110cf6c) | `claimUnownedAlbums` `src/core/household.ts:290` (albums sans propriétaire seulement) ; nouveaux albums nés au membre (`src/core/repo/albums.ts:128`) ; `owner_name` suit le profil à chaque lecture, et pré-remplit le prénom d'un nouveau membre |
| § 11 Invité membre : « Je suis… », `author_member_id`, tête à côté des commentaires et cœurs ; invité ordinaire : prénom libre | état: fermé 14d63e8 | `signer` `src/server/guest.ts:41` (le nom vient du profil, un `member_id` inconnu est refusé) ; `WhoAreYou` `src/renderer/src/features/share/GuestApp.tsx` ; test « guests who are household members » |
| § 11 Rien d'autre ne circule : originaux et photothèque restent sur la machine, pas d'album partagé par fichiers | état: conforme — verdict `MYPHOTOS-01` tranché, source modifiée (110cf6c) | aucun fichier `myphotos/` n'est écrit ; § 12 (convergence de deux appareils) sans objet tant qu'aucun flux n'existe |
| § 5 Code facultatif de l'appareil | état: hors périmètre — facultatif, non demandé en v1 | |
| Règle 6 Brume — chacun est un objet | état: fermé 7760e19 | `src/renderer/src/components/MemberHead.tsx` (copie propre de l'esquisse de la maison) ; couleurs de jardin nommées hors marqueurs `src/renderer/src/styles.css` (`--head-*`, `--figure-*`) ; le pantalon de nuit est plus clair que l'esquisse, qui disparaissait sur le fond des dialogues |

## Le relevé

| Règle (`maison/01-REGLES.md`) | État | Preuve |
|---|---|---|
| § 4 Le bloc `DH:tokens` est posé et à jour | état: conforme | `python3 ../../tools/distribute.py --check MyPhotos` |
| § 4 Aucune couleur en dur hors du bloc | état: fermé 3fac021 | `grep -rnoE '#[0-9a-fA-F]{6}\b' src/renderer --include='*.tsx' --include='*.ts' | wc -l` → 0 le 2026-10-02 (21 avant). Restent en 3 chiffres : `#fff`/`#111` du texte sur la couleur d'un souvenir (`MemoryBook.tsx`, contenu) et `#000` du canevas de l'éditeur (`renderer.ts`, pixels). Valeurs propres hors marqueurs, chacune commentée : `src/renderer/src/styles.css:97-100,106` (`--heart`, `--stage`, `--stage-panel`, `--charcoal`) |
| § 2.5 Un foyer, une seule façon de le lire | état: fermé e08e644 | section *Comptes et foyer* ci-dessus |
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
| Règle 6 — chacun est un objet | état: fermé 7760e19 | têtes d'objet des membres : réglages « Foyer » et page invité (`components/MemberHead.tsx`). Les « Personnes » restent des visages reconnus dans les photos, pas des membres |
| Pas de translucidité | état: fermé 42481c8 | `--panel` = `--dh-surface` opaque (`styles.css:84`) ; dialogues, menus, toasts, notice de mise à jour : `bg-elevated` opaque. Choix : les voiles derrière les dialogues (`bg-black/30–35`) restent, sans flou ; la visionneuse et les éditeurs gardent une scène quasi noire neutre (`--stage`) pour juger les couleurs des photos |
| Rayons | état: fermé 42481c8 | `--radius-card/sheet/pill/label` exposés à Tailwind (`styles.css:23-26`) : 3 px cartes, champs, lignes, menus ; feuille pour les dialogues ; pilule pour boutons, contrôles segmentés, recherche. Choix : les vignettes photo gardent leur arrondi (3 px dans la grille, déjà égal au jeton ; arrondi des couvertures de souvenirs et des miniatures conservé) |
| Typo — police système, deux graisses | état: fermé 76b1d91 | `grep -rn 'font-medium\|font-semibold' src/renderer --include='*.tsx'` → 0 ; boutons et ligne sélectionnée en gras |
| Mouvement — 160/220 ms, une courbe | état: fermé 76b1d91 | `--default-transition-duration` / `-timing-function` (`styles.css:29-30`), `animate-fade-in`/`pop-in` sur `--dh-motion-enter`. Exception gardée : `duration-75` de la pellicule de la visionneuse pendant le glissement (suit le pointeur) |

## Construire et tester

npm run typecheck && npm test
