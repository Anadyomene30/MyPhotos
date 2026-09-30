# MyPhotos

Application desktop (macOS + Windows) de photothèque type Apple Photos : Electron + React + TypeScript, serveur Hono embarqué, SQLite, IA locale (ONNX Runtime).
Plan complet et vision produit : `docs/PLAN.md`.

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
