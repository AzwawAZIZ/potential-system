# Suivi MIAGE · Université de Picardie Jules Verne

Prototype interactif local en français, sans dépendance d’exécution ni service distant. Jeu fictif de 12 étudiants, répartis à parts égales entre M1 et M2, et 7 rôles distincts.

## Améliorations apportées

L’agenda permet de parcourir les mois au-delà du mois de démonstration et de confirmer l’un des deux créneaux proposés. Les exports de calendrier gèrent une visite se terminant après minuit. L’activité au clavier prolonge également la session, et les filtres des journaux utilisent la date courante. Les archives de salon restent visibles uniquement aux acteurs autorisés du cycle concerné, dans le cadre simulé du prototype.

Une alerte persistante indique si le navigateur ne peut pas enregistrer les modifications. Si des données locales sont illisibles, de version inconnue ou de structure incompatible, elles ne sont pas écrasées automatiquement : le jeu de démonstration s’ouvre provisoirement en mémoire. Si la lecture ou l’écriture est indisponible, des données préexistantes peuvent ne pas avoir été chargées ; une fois le problème résolu, copiez vos saisies en mémoire avant de recharger la page pour relire les données. La réinitialisation explicite via le guide supprime les données locales, y compris dans ce cas. L’application ne propose pas de sauvegarde ni de restauration automatique : gardez à l’esprit que ce prototype ne doit contenir que des données fictives.

Si une modification est détectée dans un autre onglet pendant une saisie, celle-ci reste affichée et l’enregistrement est bloqué : copiez votre texte, puis rechargez les données. Cette protection réduit certaines pertes mais ne constitue pas une synchronisation transactionnelle. Un changement de session ou une réinitialisation dans un autre onglet peut encore interrompre la saisie.

Certains champs affichés et les exports CSV ont été renforcés contre des contenus interprétés comme HTML ou formules de tableur. Les contrôles d’import et de parcours restent des contrôles de prototype exécutés côté navigateur ; ils ne constituent pas une sécurité serveur. Voir `AUDIT.md` pour les constats et les limites restantes.

## Ouvrir l’application

### Le plus simple : un seul fichier

Ouvrir **`Suivi-MIAGE-UPJV.html`** dans un navigateur récent (Chrome, Edge ou Firefox). CSS, icônes SVG, données et JavaScript sont intégrés dans le fichier. Une connexion Internet et un serveur ne sont pas nécessaires.

L’aperçu intégré de certaines plateformes peut interdire `localStorage` : dans ce cas les interactions fonctionnent en mémoire uniquement. La conservation après fermeture dépend des autorisations et de l’espace disponible dans le navigateur, y compris pour le fichier HTML téléchargé.

### Version modulaire

```bash
cd suivi-miage
python3 -m http.server 3000 --bind 0.0.0.0
```

Puis ouvrir `http://localhost:3000`. `npm start` exécute la même commande. Aucune installation de dépendance n’est nécessaire pour faire fonctionner l’application.

## Connexion & guide

Le mot de passe de tous les comptes de démonstration est **`Miage2026!`**.

Le bouton **Guide démo & comptes**, présent sur la connexion et dans la barre latérale, déconnecte la session actuelle puis permet de se connecter à un autre compte fictif. Ce dispositif de test est distinct de l’administration : il n’existe aucune fonction « agir pour ».

| Compte | Rôle(s) | E-mail |
|---|---|---|
| Sophie Laurent | Responsable stages + Tuteur universitaire | sophie.laurent@u-picardie.fr |
| Camille Moreau | Administrateur technique uniquement | camille.moreau@u-picardie.fr |
| Thomas Lefèvre | Responsable M1 + Tuteur universitaire | thomas.lefevre@u-picardie.fr |
| Claire Dubois | Responsable M2 | claire.dubois@u-picardie.fr |
| Julien Mercier | Tuteur universitaire | julien.mercier@u-picardie.fr |
| Marc Petit | Tuteur entreprise (Lucie et Nathan) | marc.petit@atelier-numerique.fr |
| Anne Fournier | Maître de stage de Chloé | anne.fournier@groupe-verne.fr |
| Lucie Bernard | Étudiante M1, suivi actif | lucie.bernard@u-picardie.fr |
| Emma Martin | Étudiante M1, accès entreprise en attente | emma.martin@u-picardie.fr |
| Nathan Robert | Étudiant M2, désaccord CRV | nathan.robert@u-picardie.fr |
| Chloé Dubois | Étudiante M1, risque de rupture | chloe.dubois@u-picardie.fr |
| Hugo Leroy | Étudiant M2, proposition de mission en attente | hugo.leroy@u-picardie.fr |

Un compte désactivé supplémentaire est fourni pour tester les filtres et la réactivation. Les comptes créés pendant la démonstration deviennent accessibles dans le guide s’ils sont actifs.

## Parcours de recette conseillés

### 1. Désaccord, délégation, rectification et trois visas

1. Se connecter à **Sophie → Tuteur universitaire**.
2. Ouvrir **Nathan Robert → CRV**. Constater le désaccord et les visas gelés.
3. **Autoriser la modification temporaire au maître de stage**, puis confirmer.
4. Changer de compte vers **Marc**. Ouvrir **Nathan → CRV → Rectifier**.
5. Enregistrer une rectification. Vérifier : original archivé, comparaison Avant/Après, délégation fermée, désaccord levé, **0/3 visas**.
6. Revenir à **Sophie → Tuteur** pour le premier visa.
7. Passer à **Marc** pour le deuxième visa.
8. Passer à **Nathan → Mes comptes rendus → Mon CRV** pour le troisième visa.

La révocation de la délégation est également disponible tant que la rectification n’est pas enregistrée. Le responsable stages peut adresser une consigne d’arbitrage sans contourner le circuit des visas.

### 2. CRA : demande, brouillon, dépôt et décision

1. **Sophie → Tuteur → Lucie → CRA** : lire le CRA existant ou créer une nouvelle demande.
2. **Lucie → Déposer un CRA** : sélectionner une demande ou choisir le dépôt spontané.
3. Si une demande est sélectionnée, cocher explicitement la confirmation d’association.
4. Enregistrer le brouillon. Le reprendre dans **Mes comptes rendus** et choisir **Envoyer au tuteur**.
5. **Sophie → Tuteur → Lucie → CRA** : décider **Lu**, **Validé** ou **À compléter**. Un complément exige une consigne de correction.
6. Vérifier que **Marc** ne voit aucun CRA, y compris dans la chronologie.

### 3. Mission et capacité du tuteur

- **Sophie → Tuteur → Missions proposées** : proposition de Hugo, avec entreprise, adresse exacte, dates, mission et charge.
- Accepter, refuser avec motif ou demander des précisions.
- L’acceptation recontrôle la disponibilité et la capacité, actualise l’affectation et notifie les acteurs.
- Pour tester le blocage, ramener la capacité de Sophie à sa charge actuelle avant d’accepter.
- **Sophie → Responsable stages → Missions & affectations** permet de préparer d’autres propositions ; le sélecteur classe les tuteurs par disponibilité puis taux de charge.

### 4. Onboarding entreprise

1. **Emma → Mon entreprise** : modifier la demande de Paul Garnier.
2. **Sophie → Responsable stages → Accès & signalements** : confirmer la création de l’accès.
3. Vérifier le compte créé, l’e-mail simulé et le salon ouvert automatiquement (Thomas est déjà affecté).
4. Le nouveau compte apparaît dans le guide. Il ne voit que le dossier d’Emma et jamais ses CRA.
5. Une demande déjà traitée n’est plus modifiable par l’étudiant.

### 5. Signalement et rupture avec Cycle 2

1. **Sophie → Responsable stages → Accès & signalements → Signalements**.
2. Ouvrir le cas de **Chloé** : prise en charge, note, transfert à un acteur autorisé, qualification en rupture et clôture sont disponibles.
3. Ouvrir le dossier de **Chloé → Salon**. Fermer le salon avec un motif.
4. Vérifier son passage en lecture seule, puis ouvrir un nouveau cycle avec motif.
5. L’ancien contrat est archivé, les encadrants sont désaffectés et **Cycle 2** est créé.
6. **Anne** conserve l’accès à l’ancien salon archivé, mais pas au nouveau dossier : l’historique ne devient pas un moyen de contourner les affectations.

### 6. Import Mon Master

**Sophie → Responsable stages → Imports & exports** :

1. Charger le jeu d’exemple ou un fichier CSV UTF-8 (export d’Excel).
2. Contrôler les 6 lignes d’exemple : **2 créations, 1 mise à jour et 3 rejets**.
3. Vérifier les motifs de rejet par ligne : doublon, e-mail invalide, mauvaise promotion.
4. Télécharger les rejets et confirmer l’import des seules lignes valides.
5. L’historique technique visible à l’administrateur conserve uniquement fichier, auteur, date, compteurs et motifs techniques — pas les noms ou e-mails des lignes importées.

Colonnes : `nom;email;promotion;ville`. La colonne ville est facultative. Les séparateurs virgule et point-virgule et les champs entre guillemets sont acceptés ; un enregistrement par ligne. Les lignes mal formées, les doublons et les identités ambiguës sont rejetés. Les adresses et promotions sont normalisées et les données sont recontrôlées à la confirmation. La limite est de 10 000 lignes dès l’aperçu. Les `.xlsx` se traitent en les exportant en `.csv` depuis Excel, sans lecteur Excel natif embarqué. Si les données changent après l’aperçu, de nouveaux rejets peuvent apparaître à la confirmation : leurs compteurs et motifs figurent dans l’historique ; le fichier de rejets téléchargeable correspond à l’aperçu initial.

### 7. Formation, RG-10 et bascule

- **Thomas → Responsable M1** : six M1 nominatifs initialement, aucun M2 nominatif. Pas de ligne ouvrable, de CRA, de CRV, de salon ou de dossier 360°.
- **Claire → Responsable M2** : périmètre inverse. Les comparaisons de l’autre promotion sont uniquement agrégées.
- Les exports CSV respectent la promotion ; le bouton PDF ouvre l’impression native et permet de choisir **Enregistrer au format PDF**.
- **Thomas → Analyses & fin d’année** peut proposer une décision de bascule sans la mettre en œuvre.
- **Sophie → Responsable stages → Cohorte & bascule → Bascule M1 → M2** applique la décision après aperçu des conséquences. Le périmètre nominatif se met à jour immédiatement pour les deux responsables.

### 8. Gouvernance technique

**Camille** :

- Aucun dossier étudiant, affectation, import métier ou salon de projet.
- Comptes en drawer, création/modification, motif, aperçu et confirmations sensibles ; auto-désactivation et suppression du dernier rôle Admin actif bloquées.
- Matrice Lecture / Modification / Validation / Paramétrage, filtrage et comparaison de deux rôles ; règles inviolables verrouillées, pas de sauvegarde instantanée.
- Paramètres avec Ancien/Nouveau, motif, historique et délégation des seuls paramètres métier au responsable stages.
- Audit des messages directs séparé, en lecture seule, exigeant un motif enregistré avant la consultation.
- Journaux filtrables, détail en drawer et export CSV.

## Architecture

```text
index.html                 Point d’entrée de la version modulaire
styles.css                 Design system, responsive, thèmes, focus, impression
seed.js                    Données fictives et définition des sept rôles
domain.js                  Contrôles d’accès et moteur métier transactionnel
storage.js                 Contrôle de compatibilité et alertes du stockage local
ui.js                      Composants de base, échappement, SVG, éditeur riche
app.js                     Navigation, vues et orchestration des interactions
bundle.mjs                 Génération sans dépendance du HTML autonome
Suivi-MIAGE-UPJV.html       Livrable autonome généré
 tests/domain.test.js       Tests du moteur métier et des règles de sécurité
 tests/browser.mjs          Recettes navigateur de bout en bout
 tests/improvements.mjs     Régressions ciblées : stockage, exports, agenda et clavier
 tests/followup.mjs         Archives, onglets, créneaux, imports et focus
 tests/storage.test.js      Tests de lecture et d’écriture du stockage local
 tests/workflow-regression.test.js  Tests des associations CRA et transitions de visite
 tests/accessibility.mjs    Contrôles automatisés WCAG (axe-core)
 tests/standalone.mjs       Vérification du HTML autonome sans serveur
```

### Points de contrôle importants

- `activeUser`, `can`, `modeAllowed`, `requireRole` : session active, rôle détenu et permission de l’opération.
- `scopedStudents` : promotion, étudiant propriétaire ou encadrant affecté. Les responsables de formation reçoivent une projection réduite, sans e-mail ou détail de contrat.
- `dossier` : règle RG-10, séparation Admin/métier et périmètre individuel.
- `reportsFor` : auteur, responsable stages et seuls destinataires autorisés.
- `messages`, `participants`, `archivedRooms` : ciblage et conservation des archives sans accès au cycle suivant.
- `mutate` : mutations métier atomiques, recontrôle des permissions, traçabilité et notifications. Une erreur annule la transaction ; l’interface trace également les actions refusées.
- `importRows` : revalidation des lignes lors de la confirmation, indépendamment du contrôle d’aperçu.
- `safeRich` : mise en forme autorisée par liste blanche ; tout le reste est échappé. Les CSV exportés neutralisent les formules de tableur.

Les préférences de thème et de réduction des animations, ainsi que les données métier, sont conservées sous la clé **`suivi-miage-v1`**. La réinitialisation exige de saisir **RÉINITIALISER**. Les filtres, sélections, dossiers ouverts et brouillons de permissions en mémoire sont purgés lors d’un changement de rôle.

## Tests reproductibles

Node.js 20+ et Python 3 pour l’environnement de test.

```bash
# Moteur métier : aucune dépendance, aucun serveur
npm test

# Générer de nouveau le livrable autonome
npm run build

# Outils de recette, uniquement en développement
npm ci
npx playwright install --with-deps chromium

# Dans un premier terminal
npm start

# Dans un second terminal
npm run test:browser
npm run test:improvements
npm run test:followup
npm run test:accessibility
npm run test:standalone
```

La recette navigateur parcourt les sept rôles, leurs liens principaux et leurs sous-onglets. Un contrôle mobile à 390 px vérifie l’absence de débordement horizontal global. Les rapports et captures inclus dans l’archive d’origine correspondent à la recette antérieure aux améliorations ; les résultats de la nouvelle recette sont détaillés dans `AUDIT.md`.

Ces contrôles ne constituent **ni un audit RGAA exhaustif, ni une certification d’accessibilité ou de sécurité**. Une recette humaine (lecteur d’écran, clavier, zoom, cas métier) reste nécessaire pour une mise en production.

## Frontières assumées du prototype

- **Pas de sécurité serveur** : le fichier et `localStorage` sont inspectables et modifiables par leur propriétaire. Les permissions et le cloisonnement sont simulés et vérifiés dans le moteur applicatif ; ils ne remplacent jamais un serveur d’autorisation.
- **Pas d’authentification réelle** : mot de passe partagé de démonstration, pas de SSO, de chiffrement de secrets ou de récupération d’accès.
- **Pièces jointes simulées** : contrôle du format et de la taille, conservation du nom et de la taille uniquement. Pas de téléversement, de stockage binaire ou de téléchargement fictif d’un fichier qui n’existe pas.
- **E-mails et signatures simulés** : notifications locales et journal des e-mails ; les visas sont des événements de workflow, pas des signatures électroniques qualifiées.
- **PDF** : production via la fonction d’impression PDF du navigateur ; pas de moteur PDF embarqué. Calendrier exportable au format `.ics`.
- **Repères temporels** : données pédagogiques arrêtées au 21 novembre 2026 ; plusieurs dates et valeurs métier restent fixées à cette référence, y compris pour certaines nouvelles actions. Les sessions et journaux techniques utilisent l’horloge du navigateur. Les 45 jours affichés pour la période d’essai sont un repère calendaire de démonstration, pas un calcul réglementaire des jours de présence effective.
- **Analyses historiques** : 2024–2025 et 2025–2026 sont des agrégats fictifs explicitement signalés ; 2026–2027 est calculé sur les données locales.

Ne pas utiliser ce prototype avec des données personnelles réelles.
