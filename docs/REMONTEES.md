# Remontées — MyPhotos

La maison lit ce fichier **sur place** ; les verdicts s'écrivent chez elle, dans
`../../remontees/REGISTRE.md`. Chaque remontée a un titre `## MYPHOTOS-NN — objet`
et porte : ce que dit la source (fichier, section) · ce que fait le code
(`fichier:ligne`) · la question · une recommandation argumentée. Une *déclaration*
dit un fait — ce qui a changé, ce que ça touche dans la maison, le commit — et
attend « pris acte ». Numérotation continue, jamais réutilisée.

## MYPHOTOS-01 — Mécanisme B sans flux : que veut dire § 12 pour MyPhotos v1 ?

- **Ce que dit la source.** `spec/01-comptes-et-foyer.md` § 3.2 : chaque app choisit A ou B ; § 9 range MyPhotos en B ; § 5 étape 3 : l'appareil « lit et écrit ses flux » ; § 12 : une app implémente la spec quand deux appareils convergent, test automatisé à l'appui. Mais § 11 : MyPhotos est « tout perso ; les originaux ne passent pas par le dossier foyer », et § 13 garde ouvert « Albums MyPhotos partagés par fichiers ».
- **Ce que fait le code.** MyPhotos écrit `foyer.json` (s'il crée le foyer), le profil du membre qu'il crée et `appareils/<device_id>.json` (`src/core/household.ts:143`), et **aucun** fichier `myphotos/…`. Les albums désignent des fichiers de cette machine (`album_assets.asset_id`) : un instantané perso n'aurait de sens sur aucun autre appareil. Je n'ai inventé aucun flux.
- **La question.** MyPhotos v1 est-il conforme à `spec/01` en déclarant B sans écrire de flux, § 12 étant sans objet jusqu'à l'ouverture des albums partagés par fichiers ?
- **Recommandation.** Oui : l'écrire dans § 11 (« MyPhotos v1 n'écrit que `appareils/` ; § 12 s'applique avec les albums partagés par fichiers »). Le schéma (migration 18) est prêt pour l'enveloppe B le jour où le point ouvert se tranche.

## MYPHOTOS-02 — Une installation qui change de membre : à qui sont les albums ?

- **Ce que dit la source.** `spec/01` § 10 : « Au premier rattachement d'un appareil, les données déjà présentes deviennent celles du membre qui se rattache. » § 5 : « v1 : une installation = un membre » ; § 3.4 : un `device_id` ne change jamais de membre ; § 7 : la propriété ne se transfère pas en v1.
- **Ce que fait le code.** Au rattachement, seuls les albums **sans propriétaire** passent au membre (`claimUnownedAlbums`, `src/core/household.ts:290`) ; les albums créés ensuite naissent à lui (`src/core/repo/albums.ts:128`). « Quitter le foyer » oublie le dossier mais garde `member_id` et `device_id`. Si l'on se rattache ensuite comme **un autre** membre, l'appareil prend un nouveau `device_id`, mais les albums restent au premier membre.
- **La question.** Sur une même installation, passer de Alex à Sam (avant la v2 « Changer de profil ») : les albums restent-ils à Alex (pas de transfert, § 7), ou passent-ils à Sam (« les données présentes deviennent celles du membre qui se rattache », § 10) ?
- **Recommandation.** Les laisser au premier membre, comme le fait le code : c'est la seule lecture qui respecte § 7, et rien en v1 ne filtre encore par propriétaire, donc personne ne perd rien de visible. À préciser dans § 10 (« premier rattachement de l'installation ») ; le changement d'avis tient en un seul endroit (`claimUnownedAlbums`).
