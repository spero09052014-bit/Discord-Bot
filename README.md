# Gpy — bot Discord de configuration, modération et tickets

Gpy reçoit les interactions Discord via un endpoint HTTP Node.js. Il ne lit pas le contenu de tous les messages et n'a pas besoin du privilège Message Content Intent.

## Le format copiable par une IA

Le flux est conçu pour Claude, Replit Agent ou une autre IA :

1. Dans Discord, lance `/gpy-prompt`, copie le prompt donné par Gpy et remplace sa dernière ligne par le thème et tes besoins.
2. Demande à l'IA de répondre uniquement au format Gpy v1.
3. Colle sa réponse dans `/code` (jusqu'à 4 000 caractères). Pour une configuration plus longue, enregistre-la en fichier `.gpy` ou `.txt` puis utilise `/gpy-import`.
4. Gpy valide le texte et affiche un aperçu privé. Rien ne change tant que tu n'as pas cliqué sur **Appliquer**.

Ce format est une configuration, pas un programme. Gpy n'exécute jamais de JavaScript, Python ou code arbitraire. Exemple :

~~~text
#nom Gpy
#categorie ACCUEIL
#salonordre 1 reglement | type=texte
#salonordre 2 annonces | type=texte
#categorie GAMING
#salonordre 1 recherche-de-groupe | type=texte
#salonordre 2 equipe-alpha | type=vocal | limite=4
#role Moderateur | couleur=#3498DB
~~~

Directives autorisées :

- `#nom Nom du serveur` — définit le nom du serveur existant.
- `#categorie Nom` — démarre une catégorie ; les salons suivants lui appartiennent.
- `#salonordre 1 nom-du-salon | type=texte` — ajoute ou replace un salon texte dans la catégorie courante.
- `#salonordre 2 salon-vocal | type=vocal | limite=4` — ajoute un salon vocal ; `limite=0` signifie sans limite.
- `#role Nom du rôle | couleur=#RRGGBB` — crée le rôle s'il n'existe pas ou actualise sa couleur.

Gpy ne supprime aucun salon ni rôle et ne donne jamais de permission d'administrateur aux rôles créés. Un salon déjà présent avec le même nom peut être déplacé vers la catégorie demandée ; l'aperçu le signale avant toute application. Les permissions des rôles doivent être attribuées par le propriétaire dans Discord.

## Commandes

- `/gpy-prompt` : prompt prêt à coller dans un assistant IA.
- `/code` : ouvre un champ pour coller la configuration générée.
- `/gpy-import` : accepte un fichier de configuration d'au plus 20 Ko.
- `/mod warn`, `/mod timeout`, `/mod kick`, `/mod ban`, `/mod unban`.
- `/mod clear`, `/mod lock`, `/mod unlock`.
- `/ticket panneau` : publie le panneau d'ouverture des tickets.
- `/ticket fermer` : ferme un ticket sans supprimer son historique.
- `/ping` et `/aide`.

Les commandes de modération vérifient les permissions Discord de la personne. Les avertissements sont archivés dans `#logs-moderation` (ou `#journal-moderation`). Les actions de ban, kick et timeout apparaissent aussi dans le journal d'audit de Discord. Les messages de plus de 14 jours ne sont pas effacés par `/mod clear`.

Les tickets sont privés, persistants après redémarrage et limités à un ticket ouvert par personne. Ils sont verrouillés puis conservés à la fermeture, pas supprimés. Gpy crée un rôle `Support` sans permission élevée si aucun rôle Support ou Modérateur n'existe ; l'équipe doit ensuite recevoir ce rôle dans Discord.

## Installation Discord

1. Crée une application dans le Discord Developer Portal. Copie son Application ID et sa Public Key.
2. Crée le bot et garde son token secret.
3. Invite-le avec les scopes `bot` et `applications.commands`. Accorde uniquement les permissions nécessaires : Gérer le serveur, Gérer les salons, Gérer les rôles, Voir les salons, Envoyer des messages, Lire l'historique, Gérer les messages, Expulser, Bannir et Modérer les membres. N'accorde pas `Administrator`.
4. Configure `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` et `DISCORD_BOT_TOKEN` dans les secrets du Web Service Render.
5. Après le premier déploiement, règle l'Interactions Endpoint URL de l'application Discord sur `https://<nom-du-service>.onrender.com/interactions`.
6. Enregistre les commandes avec `node --env-file=.env scripts/register-commands.js`. Pour les tests, renseigne l'ID du serveur dans `DISCORD_GUILD_ID`; enlève-le pour enregistrer les commandes globalement.

Le bot modifie uniquement le serveur où il est installé. Il ne crée pas de serveur Discord et ne reçoit pas de configuration sans l'accord d'un membre qui possède les permissions requises.

## Render et développement

`render.yaml` prépare un Node Web Service, Node 22, la route de santé `/healthz` et les variables nécessaires. Le token n'est pas utilisé dans le code source ; ne le committe jamais. Une instance Render gratuite peut s'endormir : pour que les commandes restent rapides et fiables, utilise une instance toujours active.

Gpy conserve brièvement en mémoire l'aperçu privé entre `/code` et le clic **Appliquer**. Garde une seule instance du service pour que ce bouton revienne au même processus.

Pour tester localement :

~~~sh
npm test
node --env-file=.env src/server.js
~~~

Le service écoute sur `PORT` (3000 par défaut) et vérifie les signatures Ed25519 de Discord avant de traiter une interaction.

## Limites de cette version

Gpy gère les commandes, les salons, les rôles, les tickets et les actions de modération. Il ne surveille pas les messages ordinaires et n'applique pas encore de messages de bienvenue automatiques ; l'analyse personnalisée des messages demanderait un service Gateway séparé ou des règles AutoMod natives de Discord.
