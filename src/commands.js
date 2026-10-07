export const COMMANDS = Object.freeze([
  { name: "ping", description: "Vérifie la réponse du bot." },
  { name: "help", description: "Affiche les commandes disponibles." }
]);

const HELP_MESSAGE = "Commandes disponibles : /ping — vérifie la réponse du bot ; /help — affiche cette aide.";

export function buildInteractionResponse(interaction) {
  if (interaction?.type === 1) return { type: 1 };
  if (interaction?.type !== 2) {
    return { type: 4, data: { content: "Interaction non prise en charge.", flags: 64 } };
  }

  switch (interaction.data?.name) {
    case "ping":
      return { type: 4, data: { content: "Pong ! 🏓", flags: 64 } };
    case "help":
      return { type: 4, data: { content: HELP_MESSAGE, flags: 64 } };
    default:
      return { type: 4, data: { content: "Commande inconnue.", flags: 64 } };
  }
}
