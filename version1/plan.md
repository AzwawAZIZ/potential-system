# Évolution du prototype Suivi MIAGE · UPJV

## Objectif et limites

Adapter le prototype local à la gestion des stages et de l’alternance demandée, sans effacer ses parcours, ses sept rôles ou son identité visuelle. Le navigateur reste la seule source de données : toutes les habilitations et tous les envois sont des simulations. Le classeur Mon Master est analysé pour préparer un import explicite ; il ne doit jamais être copié dans le code, les jeux d’essai ou un dépôt. Le fichier de synthèse de l’enseignante n’a pas encore été fourni : son intégration spécifique sera précisée après réception.

Ce compromis n’offre ni authentification réelle ni serveur, ni confidentialité opposable aux utilisateurs techniques, ni notifications ou tâches exécutées lorsque l’application est fermée. L’utilisation de données personnelles réelles nécessite une version serveur sécurisée et une validation des règles métier.

## Parcours et règles

- Cloisonner les messages, les visites et les CRV par étudiant **et cycle**. Les nouveaux encadrants ne doivent pas accéder aux données d’une entreprise précédente ; les anciens encadrants n’accèdent pas au nouveau cycle. Les acteurs autorisés au bon cycle et la responsable stages conservent les accès prévus, avec filtrage des messages ciblés. Pour les données historiques ambiguës, préférer le refus à une attribution hasardeuse.
- Autoriser le maître de stage rattaché à consulter, mais pas à modifier, les CRA envoyés de son étudiant ; les brouillons restent réservés à leur auteur. Le tuteur peut régler la fréquence ; par défaut le repère est la fin de période en entreprise.
- Séparer l’avis du tuteur sur une mission de la décision finale d’affectation par la responsable stages. Vérifier disponibilité et capacité au moment de la décision finale ; conserver les anciens historiques sans affecter rétroactivement.
- La responsable stages n’est pas automatiquement destinataire des messages ciblés. Le choix des interlocuteurs est explicite ; permettre de contacter une adresse e-mail choisie au moyen du client de messagerie ou d’une simulation clairement identifiée, sans faire croire à un envoi automatique ou donner accès au salon à une personne extérieure.
- Permettre au maître de stage de compléter ou rectifier le CRV, puis au tuteur de reprendre le texte, en conservant les versions et sans signer à la place des acteurs. L’administrateur ne consulte pas les messages privés, y compris via la fonction d’audit.
- Pour les 45 jours en entreprise, compter des présences effectives déclarées et distinctes ; ne pas déduire la présence réelle de la simple durée du contrat. Afficher les informations manquantes et distinguer les simulations des situations confirmées.
- Afficher et gérer la clôture des CRV avec un délai modifiable, de préférence un mois par défaut ; la date de départ du délai est à confirmer. Dans le prototype local, tout contrôle automatique s’effectue uniquement quand l’application est ouverte, et la clôture ne doit pas inventer des visas.
- Présenter les échéances et relances ciblées, datées et leur dernière exécution. Les relances du prototype sont calculées/exécutées localement lors de l’ouverture ou sur action, sans e-mail réel ni travail en arrière-plan.
- Garder le calendrier de visites interactif et y intégrer les disponibilités déclarées des encadrants, sans prétendre synchroniser des agendas externes. Permettre la mise à jour des contacts et de l’adresse réelle de visite en cours d’année.
- Étendre les contrats et situations aux stages à temps plein, à la professionnalisation, aux césures, aux avenants et à l’origine des ruptures. À la bascule annuelle, conserver les apprentissages et clôturer les stages M1, avec aperçu et historique explicites.
- Préparer un import et suivi du fichier Mon Master adapté à sa structure réellement inspectée, avec aperçu, contrôle et confirmation ; ne pas attribuer arbitrairement les champs ou les candidatures aux étudiants. Préserver les mécanismes CSV existants.

## Organisation

`seed.js` contient uniquement les exemples fictifs ; `domain.js` porte les règles, périmètres et mutations ; `storage.js` conserve une validation compatible des états locaux ; `app.js`, `ui.js` et `styles.css` portent les écrans et interactions. De nouveaux modules autonomes peuvent isoler calculs et import, puis sont inclus dans `bundle.mjs` afin de préserver la version HTML autonome. `tests/` contient les vérifications de non-régression métier et navigateur ; `README.md` et `AUDIT.md` décrivent les modalités et limites effectives.
