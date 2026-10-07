# Bot Discord — commandes slash pour Render

Bot léger basé sur les interactions HTTP de Discord. Il n'ouvre pas de connexion Gateway/WebSocket permanente : le service répond aux interactions signées sur Render avec le serveur HTTP natif de Node.js et aucune dépendance à installer.

## Commandes incluses

- /ping — réponse privée pour vérifier le bot.
- /help — liste des commandes disponibles.

## Prérequis

- Node.js 22 ou plus récent.
- Une application Discord créée dans le Developer Portal.
- Un Render Web Service relié à ce dépôt.

## Configuration Discord

1. Dans le Developer Portal, crée une application et relève son Application ID et sa Public Key (General Information).
2. Dans l'onglet Bot, crée le bot et garde son token privé. Le token sert uniquement au script d'enregistrement des commandes ; ne le committe jamais.
3. Dans Installation, autorise le scope applications.commands pour l'installation sur un serveur, puis installe l'application dans ton serveur.
4. Déploie le service Render. Dans General Information, configure l'Interactions Endpoint URL avec l'adresse publique du service suivie de /interactions. Discord vérifiera automatiquement le endpoint.

## Déploiement Render

Le fichier render.yaml configure un Web Service Node.js, la route /healthz, le démarrage et les deux variables nécessaires à l'exécution. Crée le Web Service depuis ce dépôt ou utilise le Blueprint Render, puis renseigne DISCORD_APPLICATION_ID et DISCORD_PUBLIC_KEY dans l'environnement Render. Aucun token Discord n'est requis par le serveur en production.

Après le premier déploiement, l'URL d'interactions ressemble à https://nom-du-service.onrender.com/interactions. L'URL de santé est https://nom-du-service.onrender.com/healthz.

## Enregistrer les commandes

Pour enregistrer les commandes, copie .env.example vers .env et renseigne DISCORD_APPLICATION_ID ainsi que DISCORD_BOT_TOKEN. Lance ensuite :

~~~sh
node --env-file=.env scripts/register-commands.js
~~~

Les commandes globales peuvent prendre un certain temps à apparaître. Pour tester immédiatement sur un serveur, ajoute son ID dans DISCORD_GUILD_ID avant d'exécuter le script. Une fois le test terminé, retire cette variable et relance le script pour publier les commandes globalement.

## Développement local et tests

~~~sh
npm test
node --env-file=.env src/server.js
~~~

Le serveur écoute sur PORT (3000 par défaut) et sur 0.0.0.0, comme attendu par Render.

## Latence et disponibilité

Le code évite les dépendances et les connexions persistantes inutiles. Pour des réponses régulières et rapides, choisis une instance Render toujours active : une instance gratuite peut s'endormir après une période sans trafic, alors que Discord attend une réponse rapide à chaque interaction.
