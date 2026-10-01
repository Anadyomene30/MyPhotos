# MyPhotos — plan fonctionnel et technique

## Contexte

Tu veux une application de photothèque type Apple Photos, mais à ton ergonomie, sur **Mac et Windows**. Elle lit un dossier local (jamais ne modifie les originaux), gère jusqu'à **200 000 fichiers** (JPEG, HEIC + Live Photos, vidéos HEVC/H.264, RAW), avec :
albums manuels et **partagés en famille via un serveur sur ton réseau local**, nettoyage intelligent (doublons, quasi-doublons, « laquelle garder »), export/conversion photos et vidéos, séparation photos/vidéos, reconnaissance de visages, vidéo rétrospective, **composition automatique d'albums avec belle mise en page**, et **tri automatique de tout**. IA 100 % locale, avec API Claude en option (légendes, titres).

Le dossier projet est vide. Toolchain dispo : Node 26, ffmpeg 9, Python 3.11 (non utilisé).

---

## 1. Fonctionnalités (vision produit)

### Bibliothèque
- **Timeline** groupée Années › Mois › Jours avec pincement/zoom (raccourcis `1`/`2`/`3`), scrubber latéral, en-têtes collants (lieu + date : « Biarritz, 12 août 2023 »).
- **Filtres en un clic** dans la barre : Tout · Photos · Vidéos · Live · Captures d'écran · Favoris · RAW. Combinables avec personne / lieu / année.
- Visionneuse plein écran : flèches, zoom, Live Photo (maintien clic), lecture vidéo, panneau infos (EXIF, carte, personnes, fichiers liés), `Espace` = aperçu rapide.
- Sélection multiple (Maj/Cmd, glisser-lasso), favoris `.`, note 1–5, mots-clés.
- **Corbeille interne** 30 jours : rien n'est effacé du disque sans passer par elle ; vidage = mise à la corbeille système.
- Surveillance du dossier : nouveaux fichiers indexés en direct.
- Réglage « Clé d'import » : dossier `Partagés/` où arrivent les ajouts famille.

### Recherche
- Barre unique : texte libre (« chien plage 2022 », « anniversaire Léa »), noms de personnes, lieux, dates, appareil, type.
- **Recherche sémantique locale** (CLIP) : décrire une scène en français → résultats sans mots-clés.
- Suggestions au fil de la frappe (personnes, lieux, catégories).

### Personnes
- Détection + regroupement automatique des visages, vignettes rondes, nommage (autocomplete), fusion de doublons de personne, « Ce n'est pas X ».
- Page personne : timeline, compteurs, co-occurrences (« souvent avec … »), favoris.
- Masquer une personne, confirmer les suggestions par lots (« Est-ce Léa ? » oui/non en rafale).

### Lieux
- Carte (tuiles OpenStreetMap, MapLibre) avec clusters, géocodage inverse local hors-ligne (villes/pays) pour les libellés.

### Albums
- Albums manuels (glisser-déposer, tri libre, couverture), dossiers d'albums.
- **Albums intelligents** : règles (personne, lieu, date, type, note, mots-clés…) mis à jour en continu.
- **Albums partagés** : invitation par lien/QR code, droits « voir » ou « voir + ajouter », commentaires ❤️, notification des ajouts, export « télécharger tout » côté famille.

### Tri automatique (« Organiser »)
- **Moments** : découpage automatique de la photothèque en événements (rupture temporelle + distance GPS + similarité visuelle). Chaque moment reçoit un titre auto (lieu + date, ou « Week-end à Lyon », « Noël 2024 »).
- **Catégories auto** (CLIP zéro-shot) : Captures d'écran, Documents/tickets, Nourriture, Animaux, Paysages, Selfies, Enfants, Sport, Nuit, Voitures… Visibles comme filtres et dans la recherche.
- **Voyages** : suite de moments loin de « chez moi » (défini une fois) sur plusieurs jours.
- **Années en revue** : vue par année avec ses moments, ses personnes, ses lieux, ses chiffres.
- Option « Ranger dans des dossiers » : proposer (jamais imposer) une arborescence `Année/Mois — Moment` avec déplacement ou copie, aperçu avant application.

### Compositions automatiques (« Souvenirs »)
- Génération automatique et périodique de souvenirs : « Il y a un an », « Meilleures photos de 2023 », « Léa au fil des ans », « Été à la mer », « Les animaux », « Ce mois-ci il y a 5 ans ».
- Sélection auto des **meilleures photos** (netteté, exposition, visages, diversité, pas de doublons) + couverture choisie.
- **Mise en page éditoriale** : gabarits de type livre photo (héro pleine page, mosaïques 2/3/5, page titre avec typographie, légendes auto, page carte du voyage). Rendu HTML/CSS, donc joli et thémable (palettes extraites des photos dominantes).
- Un souvenir peut être : enregistré en album, exporté en **PDF livre photo** (formats 21×21, A4, 30×30 imprimables), en **galerie web** statique, ou converti en **vidéo** (voir Rétrospective).
- Titres/légendes : locaux par défaut (gabarits), enrichis par Claude si activé (« Une semaine dorée en Toscane »).

### Nettoyage
- **Doublons exacts** (même contenu) : groupes, la copie à garder pré-cochée (chemin le plus « propre », plus ancien), un bouton « Tout nettoyer ».
- **Quasi-doublons / rafales / très similaires** : groupes avec **suggestion de laquelle garder** et explication (« plus nette », « yeux ouverts », « meilleure résolution »), comparaison côte à côte, loupe synchronisée.
- **Suggestions de suppression** : captures d'écran anciennes, photos floues, très sombres, vidéos très lourdes ou très courtes, fichiers de 0 octet, HEIC + JPEG identiques, Live Photos sans intérêt (option).
- Tableau de bord : espace récupérable en Go, progression, historique.

### Export & conversion
- Panneau d'export unique : formats image (JPEG, PNG, WebP, HEIC, TIFF), vidéo (MP4 H.264/H.265, ProRes, WebM, GIF), taille (originale, 4K, 1080p, 2048 px, web), qualité, métadonnées (garder / retirer GPS / tout retirer), renommage par motif (`{date}_{lieu}_{n}`), structure de dossiers.
- **Préréglages** (« Pour WhatsApp », « Pour impression », « Archive 100 % ») et glisser-déposer direct vers Finder/Explorateur.
- Conversion par lots en arrière-plan avec file d'attente, accélération matérielle.
- Export d'un album ou d'un souvenir en galerie HTML autonome.

### Rétrospective vidéo
- Assistant : source (toute la photothèque, une année, un moment, une personne, un album) → durée cible → style (Ken Burns doux, coupes rapides, mosaïque) → musique (fichier local, fondu auto) → format (16:9, 9:16 vertical, 1:1) → résolution 1080p/4K.
- Cartes titres par année/moment, transitions, courts extraits des vidéos (3 s), rythme calé sur la durée.
- Aperçu rapide basse définition avant rendu final.

### Ergonomie et esthétique
- Barre latérale : Bibliothèque · Photos · Vidéos · Souvenirs · Personnes · Lieux · Albums · Partagés · Nettoyage · Projets (rétrospectives, livres) · Corbeille.
- Thème clair/sombre, coins doux, vignettes bord à bord, animations sobres, palette neutre qui laisse la place aux photos.
- Panneau de progression des tâches en bas (indexation, IA, exports) jamais bloquant.
- Palette de commandes `Cmd/Ctrl+K`, raccourcis partout, tout est réversible (annuler).
- Interface en français, anglais prévu (i18n dès le départ).

### IA cloud (option, désactivée par défaut)
- Clé API Claude dans les réglages. Utilisée uniquement pour : titres/légendes de souvenirs, description accessible d'une photo, recherche « avancée ». Envoi de vignettes réduites, jamais d'originaux, avec confirmation par lot.

---

## 2. Architecture technique

### Choix de la pile (validés)
- **Electron 44 + electron-vite 5 + React 19 + TypeScript 5 + Tailwind 4.** Un seul package, dossiers stricts.
- Le renderer parle **uniquement HTTP/WebSocket au serveur embarqué** (Hono, loopback `127.0.0.1`, jeton). Le même build React sert le desktop et les clients web LAN : le partage famille n'est qu'un bind sur `0.0.0.0` + auth.
- **Données** : better-sqlite3 + drizzle (WAL). Vignettes sur disque shardé `cache/ab/cd/<id>.webp` (256 px pour tout, 1024 px à la demande, LRU).
- **Décodage** :
  - JPEG/PNG/WebP/TIFF → sharp.
  - **HEIC** → ffmpeg **≥ 8.1** bundlé à la main dans `resources/ffmpeg/<os>-<arch>/` (les prébuilds sharp n'ont pas HEIC ; `ffmpeg-static` est en 6.1 et ne réassemble pas les tuiles iPhone). Fallback libheif-js WASM.
  - **RAW** → `extract-raw-preview` (JPEG embarqué plein format) pour vignettes/visionnage, `libraw-wasm` pour export démosaïqué.
  - Vidéos → ffprobe (métadonnées), ffmpeg (poster, conversion, encodeurs matériels videotoolbox/nvenc/qsx avec fallback libx264).
  - Live Photos : appairage HEIC+MOV par nom puis confirmation via tag `com.apple.quicktime.content.identifier`.
- **ML** en `utilityProcess` dédié (isolation crash) : `onnxruntime-node` 1.29 (CoreML sur mac, DirectML sur Windows).
  - Visages : SCRFD `det_10g` + ArcFace `w600k_r50` (InsightFace, usage perso ; interface `FaceDetector`/`FaceEmbedder` abstraite pour basculer sur YuNet + SFace Apache-2.0 si distribution).
  - Sémantique + catégories : CLIP ViT-B/32 via `@huggingface/transformers` (texte→image, zéro-shot).
  - Modèles (~500 Mo) **téléchargés à la première activation** dans `userData/models/` avec SHA-256 et reprise, pas bundlés.
  - Vecteurs : brute force en mémoire dans le process ML (fp16), pas de sqlite-vec avant 500k.
  - Visages : clustering **incrémental** par centroïdes (cos > 0,55, min 3 visages pour créer une personne).
- **Doublons** : xxhash tête+queue+taille puis SHA-256 sur collision. Quasi-doublons : pHash 64 bits découpé en 4 colonnes 16 bits indexées (multi-index hashing), jamais de N².
- **Score qualité** : variance Laplacien (netteté), clipping histogramme (exposition), résolution, yeux ouverts (landmarks), taille de fichier.
- **Moments** : tri chronologique, coupure si Δt > seuil adaptatif ou Δdistance > 2 km, fusion si similarité CLIP forte ; titre = géocodage inverse local + gabarits.
- **Souvenirs** : moteur de règles (calendrier, personnes, catégories, lieux) → sélection par score qualité + diversité (MMR sur embeddings CLIP) → gabarit de mise en page (JSON) rendu en React ; export PDF via impression Chromium (`printToPDF`), vidéo via pipeline rétrospective.
- **Rétrospective** : pré-scale sharp 1920×1080, `zoompan` par clip en parallèle, `xfade` par lots de ~20, `concat`, musique `-stream_loop -1 -shortest -af afade`, `yuv420p`.
- **Serveur LAN** : Hono dans un `utilityProcess`, HTTP (pas de self-signed en LAN ; HTTPS distant via `tailscale serve`), lien d'invitation → cookie session, PIN optionnel, upload multipart streamé (busboy) vers `<bibliothèque>/Partagés/<album>/` (seul dossier écrit), découverte `bonjour-service` + **QR code IP:port**. Règle pare-feu Windows ajoutée par l'installeur NSIS.
- **Packaging** : electron-builder 26, `npmRebuild: false`, `asarUnpack` (sharp, better-sqlite3, onnxruntime, WASM), ffmpeg en `extraResources`. **Deux DMG** (arm64, x64) + NSIS x64. Entitlements mac (`allow-jit`, `disable-library-validation`, inherit pour utilityProcess), descriptions d'usage Dossiers/Volumes. Chemins longs Windows préfixés `\\?\`.

### Structure des dossiers
```
MyPhotos/
  electron.vite.config.ts
  electron-builder.yml
  package.json
  resources/ffmpeg/{darwin-arm64,darwin-x64,win32-x64}/   (ffmpeg + ffprobe ≥ 8.1, licence)
  src/main/        fenêtre, menu, dialogs, lancement des utilityProcess
  src/preload/     window.desktop (dialogs, révéler dans Finder, glisser-déposer natif)
  src/core/        Node pur, testable : db/ (schema.ts, migrations), scan/ (fdir + chokidar), media/ (decode.ts, thumbs.ts, exif.ts, hash.ts), organize/ (moments.ts, categories.ts, memories.ts, quality.ts), export/ (images.ts, video.ts, retrospective.ts, book.ts), jobs/ (queue, progression)
  src/ml/          utilityProcess : faces.ts, clip.ts, cluster.ts, models.ts (téléchargement)
  src/server/      Hono : app.ts, auth.ts, routes/ (assets, albums, shares, upload, search, jobs), ws.ts, static
  src/renderer/    React : app/, features/ (library, viewer, people, places, albums, memories, cleanup, export, retrospective, settings, share), components/ui, api/ (client HTTP/WS unique), i18n/
  src/shared/      types zod partagés core ↔ renderer
  tests/           vitest (core), fixtures (mini photothèque de test : jpg, heic, raw, mov, doublons)
```

### Schéma SQLite (tables essentielles)
`assets` (path unique, kind, taille, mtime, taken_at, tz, dimensions, orientation, lat/lon, appareil, durée, live_pair_id, sha256, xxh, phash + ph0..ph3, quality, thumb_state, missing_at, trashed_at) · `faces` (asset_id, bbox, landmarks, quality, person_id, emb BLOB) · `persons` · `clip_emb` · `categories` (asset_id, label, score) · `moments` + `moment_assets` · `memories` (type, titre, layout JSON, cover) · `albums` (manuel / intelligent règles JSON) + `album_assets` · `shares` (album_id, token, can_add, expires) · `comments` · `places` (géocodage inverse) · `keywords` · `search_fts` (FTS5) · `jobs` · `settings`.
Index : `(taken_at DESC)`, `(kind, taken_at)`, `sha256`, `ph0..ph3`, `person_id`, `trashed_at`.

---

## 3. Phases de réalisation

### Phase 0 — Socle (1 sem.)
Scaffold electron-vite, Tailwind, design system (tokens, thème clair/sombre, composants de base), serveur Hono loopback + client API, better-sqlite3 + drizzle + migrations, file de tâches avec progression, ffmpeg bundlé et détecté, tests vitest, packaging minimal qui démarre sur mac et Windows.

### Phase 1 — Bibliothèque (2 sem.)
Choix du dossier, scan initial (fdir) + watcher, EXIF/ffprobe, décodage JPEG/HEIC/RAW/vidéo, vignettes, timeline virtualisée groupée (@tanstack/react-virtual + layout engine), filtres Photos/Vidéos/Live/Captures, visionneuse, favoris/notes, corbeille interne, sélection multiple, palette de commandes.

### Phase 2 — Albums, export, conversion (1,5 sem.)
Albums manuels et intelligents, glisser-déposer, panneau d'export avec préréglages, conversion par lots (sharp / ffmpeg / libraw), renommage, galerie HTML.

### Phase 3 — Nettoyage (1,5 sem.)
Hash exact, pHash multi-index, score qualité, groupes de similaires avec suggestion expliquée, comparateur, suggestions de suppression, tableau de bord.

### Phase 4 — IA locale : personnes, recherche, catégories (2 sem.)
Téléchargeur de modèles, process ML, détection/embedding visages, clustering incrémental, UI Personnes, CLIP (recherche sémantique, catégories zéro-shot), recherche unifiée FTS5 + vecteurs, carte des lieux + géocodage inverse local.

### Phase 5 — Organiser & Souvenirs (2 sem.)
Moments, voyages, années en revue, proposition d'arborescence, moteur de souvenirs, gabarits de mise en page éditoriale, export PDF livre photo, option Claude pour titres/légendes.

### Phase 6 — Rétrospective vidéo (1 sem.)
Assistant, pipeline ffmpeg (zoompan/xfade/concat/musique), aperçu basse définition, projets sauvegardés.

### Phase 7 — Partage famille (1,5 sem.)
Bind LAN, invitations/QR, sessions, droits, upload mobile, commentaires/❤️, notifications d'ajouts, `tailscale serve` documenté, règle pare-feu Windows, page « Partagés » côté desktop.

### Phase 8 — Finitions et distribution (1 sem.)
Raccourcis, animations, i18n EN, accessibilité, notarisation mac, installeur Windows, mises à jour auto (electron-updater), doc utilisateur.

---

### Ajouts demandés en cours de route (faits)
- **Bracketing → HDR** : détection des séries (même appareil, ouverture et ISO, vitesses différentes, ≥ 1,5 IL), fusion Mertens avec alignement MTB dans un worker, résultat rangé dans « MyPhotos Créations » (source dédiée), onglet Bracketing du Nettoyage et action « Fusionner » sur une sélection.
- **Éditeur photo non destructif** : pipeline TypeScript partagé (aperçu worker, vignettes, export), lumière, couleur, détails, effets, filtres, amélioration auto, recadrage/redressement/rotation/miroir. « Revenir à l’original » à tout moment ; « Enregistrer une copie » crée un fichier empilé sous l’original (versions, un seul élément dans la grille).
- **Éditeur vidéo** : découpe, vitesse, rotation/miroir/format, couleur, netteté, débruitage, stabilisation, volume ; rendu ffmpeg dans « MyPhotos Créations ».
- **RAW + JPEG** regroupés en un seul élément.

- **Livre photo qui recadre bien** : points d'intérêt (visages, sinon saillance), mise en page justifiée qui garde le format de chaque photo, quasi-doublons écartés.
- **Dossiers d'alias → albums** : un dossier d'alias Finder (ex. albums exportés d'Apple Photos) devient un album MyPhotos, une seule fois ; les alias ne sont jamais indexés comme photos.
- **« Est-ce la même personne ? »** : suggestions de fusion calibrées sur la vraie photothèque (cosinus des centroïdes ≥ 0,40), réponses « non » mémorisées ; petits groupes rangés sous « Autres visages ».

### État d’avancement (2026-10-01)
Phases 0 à 7 terminées, plus les ajouts ci-dessus.
- Phase 5 : Moments et voyages, Souvenirs composés (sélection MMR, thèmes de couleur), livre photo PDF, titres Claude en option, rangement de dossiers proposé.
- Phase 6 : rétrospective vidéo (photos animées, cartes années, extraits vidéo, fondus, musique, aperçu 360p).
- Phase 7 : partage famille sur le réseau local (lien + QR code, voir ou voir et ajouter, code facultatif), page invité mobile (cœurs, commentaires, ajouts dans `Partagés/`, ZIP), prénom affiché réglable.
- Prochaine : phase 8. Packaging electron-builder, ffmpeg ≥ 8.1 embarqué (téléchargement à valider), tests Windows, i18n EN, accessibilité, mises à jour auto, doc utilisateur.

## 4. Vérification
- **Tests unitaires** (vitest) sur `src/core` : hash, pHash, moments, sélection de souvenirs, règles d'albums intelligents, décodage sur la mini-photothèque de test (jpg, heic iPhone à tuiles, raw NEF/CR2/DNG, mov live, doublons exacts et rafales).
- **Tests de perf** : script générant 200 000 entrées synthétiques → timeline fluide (< 16 ms/frame au scroll), recherche < 100 ms, scan initial mesuré.
- **Test manuel par phase** dans l'app lancée (`npm run dev`) sur mac, puis build Windows testé (VM ou PC) à partir de la phase 1 pour attraper tôt les problèmes de chemins/pare-feu/HEIC.
- **Partage** : téléphone sur le même Wi-Fi ouvre le QR code, voit l'album, ajoute une photo qui apparaît dans `Partagés/` et dans la timeline.
- **Rétrospective** : rendu d'une année de 300 photos + musique en 1080p, vérification durée/transitions/son.
- **Packaging** : DMG arm64 et NSIS x64 installés sur machine vierge, modèles téléchargés, visages détectés.

## 5. CLAUDE.md du projet (créé en phase 0)
Contenu à y inscrire, sur ta demande :
- **Autonomie maximale** : enchaîner les tâches sans rendre la main tant qu'il reste du travail faisable seul (scaffold, code, tests, builds, corrections). Ne s'arrêter que pour : une décision produit ambiguë, un test sur ton matériel (PC Windows, téléphone), une action destructive, ou une clé/identifiant.
- À chaque fin de phase : lancer les tests, lancer l'app, vérifier visuellement, corriger, puis passer à la phase suivante sans attendre.
- **Modèle** : tu restes sur Opus high. Le récap indique explicitement « passer sur Fable » uniquement pour : phase 4 (pipeline ML complet : process ORT, clustering, recherche vectorielle) et phase 5 (moteur de souvenirs + mise en page), ou si Opus xhigh a échoué deux fois sur un même problème. Sinon « rester sur Opus ».
- Conventions : TypeScript strict, français dans l'UI, anglais dans le code, commits par fonctionnalité, jamais toucher aux originaux de la photothèque, toute suppression passe par la corbeille interne.
- Commandes : `npm run dev`, `npm test`, `npm run build:mac`, `npm run build:win`.

## 6. Décisions prises pour toi (à contester si besoin)
- Electron plutôt que Tauri (ML et médias en Node, un seul langage, HEVC identique sur les deux OS).
- Modèles InsightFace (usage perso) avec interface prête pour des modèles Apache-2.0 si tu distribues un jour.
- Partage en HTTP sur le LAN, HTTPS via Tailscale pour l'extérieur.
- Rien ne quitte ton ordinateur sans activation explicite de l'API Claude.
- Nom provisoire : MyPhotos.
