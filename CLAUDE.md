# MyPhotos

Application desktop (macOS + Windows) de photothèque type Apple Photos : Electron + React + TypeScript, serveur Hono embarqué, SQLite, IA locale (ONNX Runtime).
Plan complet et vision produit : `docs/PLAN.md`.

## La maison

La loi de ce produit n'est pas ici. Elle est à la racine de `LesDaguesHautes`,
deux crans au-dessus de ce dossier (`../../`), elle fait foi, et **elle n'est
recopiée nulle part** — pas même en résumé. Ce dossier est un dépôt git à part ;
la maison en est un autre : chacun se commite chez lui, et ce dépôt ne porte
jamais un fichier de la maison.

**Avant toute autre chose, dans une session ouverte ici :**

    python3 ../../tools/depuis.py MyPhotos

Il dit ce qui a changé dans la maison depuis la dernière session, l'état des
jetons, ce qui attend un verdict et ce qui attend d'être appliqué.

**À lire, dans cet ordre :** `../../maison/00-LIRE-DABORD.md`, puis les quatre
autres documents de `../../maison/` ; `../../maison/produits/myphotos.md` ; puis les
sources que `00-LIRE-DABORD.md` désigne.

**Deux niveaux :** `maison/` fait foi pour tous les produits ; `design/` et
`spec/` font foi sur le détail ; la fiche produit ne fait foi que sur ce qui est
propre à ce dépôt. Deux niveaux qui se contredisent : celui du dessus a raison,
**et la contradiction se remonte**.

**Ce qui monte d'ici** va dans `docs/REMONTEES.md`, sous la numérotation continue
`MYPHOTOS-NN` — une question est une *remontée*, un fait est une *déclaration* ;
ce qui n'est pas dans ce fichier, la maison ne le voit pas. **Ce qui descend** se
lit sur place dans `../../remontees/REGISTRE.md`.

**Une demande neuve passe par `../../maison/03-LA-PORTE.md`** — quatre questions,
et un seul oui arrête la session.

**Aucune valeur de jeton écrite à la main** : le bloc `DH:tokens` de ce dépôt
(`src/renderer/src/styles.css`) est écrit par `../../tools/distribute.py` entre deux marqueurs. Ce
qui est entre les marqueurs ne s'édite pas — si une valeur est fausse, c'est
`design/tokens.json` qui a tort ; ce qui est hors des marqueurs appartient à ce
produit.

**En finissant**, la ligne du marqueur en tête de `docs/ALIGNEMENT.md` :

    Maison lue jusqu'à : <sha> (<date>)

## Façon de travailler (demandé par Dimitri)

- **Autonomie maximale.** Enchaîner les tâches sans rendre la main tant qu'il reste du travail faisable seul : scaffold, code, tests, builds, corrections, phase suivante. Ne s'arrêter que pour : une décision produit réellement ambiguë, un test sur son matériel (PC Windows, téléphone), une action destructive, ou une clé/identifiant.
- À chaque fin de phase : lancer les tests, lancer l'app, vérifier visuellement (navigateur intégré / captures), corriger, puis passer à la phase suivante sans attendre.
- **Modèle.** Dimitri reste sur Opus high par défaut. Dans le récap, indiquer explicitement « passer sur Fable » uniquement pour : la phase 4 (pipeline ML complet : process ORT, clustering visages, recherche vectorielle), la phase 5 (moteur de souvenirs + mise en page), ou si Opus xhigh a échoué deux fois sur un même problème. Sinon écrire « rester sur Opus ».

## Règles produit non négociables

- Ne jamais modifier, déplacer ou supprimer un original de la photothèque, sauf action explicite de l'utilisateur passant par la corbeille interne (30 jours) puis la corbeille système.
- Le seul dossier où l'app écrit dans la photothèque : `<bibliothèque>/Partagés/` (ajouts famille).
- Rien ne quitte l'ordinateur sans activation explicite de l'API Claude dans les réglages ; jamais d'originaux, seulement des vignettes réduites.

## Conventions

- TypeScript strict, ESM. Code et commentaires en anglais, interface utilisateur en français (i18n prêt pour l'anglais).
- Le renderer ne parle qu'au serveur Hono embarqué (HTTP/WS sur 127.0.0.1) : pas d'IPC métier, seulement `window.desktop` pour dialogs natifs et ouverture dans Finder/Explorateur.
- `src/core` est du Node pur, sans import Electron, testable avec vitest.
- Travail lourd (ML, ffmpeg, hash) dans des `utilityProcess` ou des jobs de la file, jamais dans le thread principal ni dans une requête HTTP.
- Un commit par fonctionnalité, message en anglais, impératif.

## Commandes

- `npm run dev` — app en développement (electron-vite)
- `npm test` — tests vitest
- `npm run typecheck` — vérification TypeScript
- `npm run build:mac` / `npm run build:win` — packaging electron-builder

## Structure

```
src/main      fenêtre, menu, lancement des utilityProcess
src/preload   window.desktop
src/core      db, scan, media (decode/thumbs/exif/hash), organize, export, jobs
src/ml        utilityProcess IA : faces, clip, cluster, models
src/server    Hono : routes, auth, upload, ws
src/renderer  React : features/, components/ui, api/
src/shared    types zod partagés
resources/ffmpeg/<os>-<arch>/   ffmpeg + ffprobe ≥ 8.1 (HEIC iPhone)
```
