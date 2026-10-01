# MyPhotos — guide d'utilisation

MyPhotos est une photothèque qui lit vos dossiers de photos et de vidéos, sur Mac et Windows.
Vos fichiers restent où ils sont. MyPhotos ne les modifie jamais, ne les déplace pas et ne les supprime pas sans votre accord explicite.

## Démarrer

1. Ouvrez MyPhotos et choisissez un ou plusieurs dossiers (disque interne, disque externe, NAS).
2. L'analyse commence tout de suite : dates, vignettes, puis qualité et lieux. La photothèque est utilisable pendant ce temps.
3. Dans les **Réglages**, activez l'**intelligence locale** pour reconnaître les visages et chercher par description. Les modèles (environ 350 Mo) sont téléchargés une seule fois. Tout se passe ensuite sur votre ordinateur.

Les nouveaux fichiers ajoutés dans vos dossiers apparaissent automatiquement.

## Parcourir

- **Années, Mois, Jours, Moments** : quatre façons de regrouper la timeline. Les Moments découpent vos photos en événements titrés (lieu, date).
- **Tout, Photos, Vidéos** : séparer photos et vidéos en un clic.
- **Catégories** (barre latérale) : paysages, animaux, fêtes, captures d'écran…, reconnues automatiquement.
- **Recherche** : un mot, un lieu, une personne, une année, ou une description (« coucher de soleil sur la plage »).
- **Visionneuse** : double-clic ou `Entrée` pour ouvrir, flèches pour naviguer, `.` pour un favori, `I` pour les infos, `E` pour retoucher, `F` pour afficher les visages.

Les Live Photos, les paires RAW + JPEG et les copies retouchées forment chacune un seul élément.

## Personnes

- Les visages sont regroupés automatiquement. Double-cliquez sur une personne pour la nommer.
- **« Est-ce la même personne ? »** : MyPhotos vous montre les groupes qui se ressemblent (souvent la même personne à des âges différents). Répondez Oui ou Non. Un « Non » n'est plus jamais redemandé.
- Pour fusionner à la main, sélectionnez plusieurs personnes (⌘ ou Ctrl + clic) puis **Fusionner**.
- Les personnes vues sur une ou deux photos sont rangées sous **Autres visages**.

## Albums

- **Albums manuels** : glissez des photos dessus, ou utilisez le menu d'une sélection.
- **Albums intelligents** : des règles (personne, lieu, année, type, note) tenues à jour automatiquement.
- **Dossiers d'alias** : un dossier rempli d'alias Finder (par exemple vos albums exportés d'Apple Photos) devient un album MyPhotos du même nom. Si vous supprimez cet album, il n'est pas recréé.

## Souvenirs et livres photo

La page **Souvenirs** compose des sélections : années, voyages, personnes, thèmes, « ce jour-là ».
Chaque souvenir s'ouvre comme un livre photo mis en page automatiquement : chaque photo garde son format, et les recadrages pleine page suivent les visages.

- **Enregistrer en album**, **Régénérer** ou **Exporter en PDF** (carré, A4 ou grand format), prêt à imprimer.
- **Titres par Claude** (option) : avec une clé API dans les réglages, la baguette magique propose un titre et des légendes plus évocateurs. Seules quelques vignettes réduites sont envoyées, uniquement quand vous cliquez.

## Vidéo souvenir

**Créer une vidéo souvenir** depuis la page Souvenirs, un souvenir, le menu d'un album, la page d'une personne ou une sélection. Choisissez la source (toute la photothèque, une année, l'album, la personne, la sélection), la durée, le rythme, le format (16:9, vertical, carré) et une musique.
Un aperçu rapide est proposé avant le rendu final. Les vidéos sont enregistrées dans `Images/MyPhotos Créations`.

## Retouche

- **Photos** : lumière, couleur, détails, effets, filtres, amélioration automatique, recadrage et redressement. Les retouches ne touchent jamais l'original.
- **Revenir à l'original** à tout moment. **Enregistrer une copie** crée un fichier séparé, empilé sous l'original.
- **Vidéos** : découpe, vitesse, rotation, couleur, stabilisation, volume.
- **Bracketing** : les séries de la même scène à différentes expositions sont détectées (onglet Bracketing du Nettoyage). **Fusionner** produit une version HDR bien exposée.

## Nettoyage

- **Doublons exacts** : la copie à garder est pré-choisie. Le contenu est vérifié octet par octet avant toute mise à la corbeille.
- **Photos très similaires et rafales** : MyPhotos suggère laquelle garder et explique pourquoi (plus nette, mieux exposée…).
- **Suggestions** : photos floues, très sombres, vieilles captures d'écran, vidéos très courtes.

Tout passe d'abord par la **corbeille de MyPhotos**. Vider cette corbeille envoie les fichiers dans la corbeille de votre ordinateur, d'où vous pouvez encore les récupérer.

## Exporter

Sélectionnez des éléments puis **Exporter** : format (photos en JPEG, WebP, AVIF, PNG ou TIFF ; vidéos en MP4 H.264, MP4 HEVC, WebM, ProRes ou GIF animé), taille, qualité, métadonnées (garder, retirer le GPS, tout retirer), renommage. Des préréglages couvrent les cas courants : Partager, Web, Impression, Originaux, Montage.

## Partager avec la famille

1. Ouvrez un album, menu **…** puis **Partager avec la famille**.
2. Cliquez **Activer** : le partage fonctionne sur votre réseau local (même Wi-Fi). Rien ne passe par internet.
3. **Créer le lien** : choisissez « voir seulement » ou « voir et ajouter », et un code d'accès si vous voulez.
4. Vos proches scannent le **QR code** avec leur téléphone. Ils voient l'album, mettent des cœurs, commentent, téléchargent l'album en ZIP et, si vous l'avez permis, ajoutent leurs photos.

Les photos ajoutées arrivent dans le dossier `Partagés/<album>` de votre photothèque et dans l'album. C'est le seul dossier dans lequel MyPhotos écrit.
Un lien peut être **révoqué** à tout moment. Le prénom affiché aux invités se règle dans les Réglages.

**Depuis l'extérieur de la maison** : installez [Tailscale](https://tailscale.com) sur cet ordinateur et sur le téléphone de la personne. Partagez ensuite l'adresse Tailscale de l'ordinateur à la place de l'adresse locale (par exemple `http://100.x.y.z:47810/s/…`).

**Windows** : l'installeur autorise MyPhotos dans le pare-feu, uniquement sur les réseaux privés. Si Windows demande l'autorisation au premier partage, choisissez « Réseaux privés ».

## Vie privée

- Tout le traitement (visages, recherche, catégories, lieux) se fait sur votre ordinateur.
- Rien ne quitte l'ordinateur, sauf si vous activez la clé Claude, et alors seulement de petites vignettes, sur votre demande.
- La carte télécharge les fonds de carte OpenStreetMap et les garde en cache.
- Vos données MyPhotos (index, vignettes, modèles) sont dans :
  - macOS : `~/Library/Application Support/MyPhotos/library`
  - Windows : `%APPDATA%\MyPhotos\library`

## Installer

- **Mac (Apple Silicon)** : ouvrez `MyPhotos-<version>-arm64.dmg` et glissez MyPhotos dans Applications. L'app n'est pas encore signée par Apple : au premier lancement, faites clic droit sur MyPhotos puis **Ouvrir**.
- **Windows** : lancez l'installeur `MyPhotos Setup <version>.exe`.

MyPhotos embarque ffmpeg pour lire les photos iPhone (HEIC) et les vidéos : rien d'autre à installer.
