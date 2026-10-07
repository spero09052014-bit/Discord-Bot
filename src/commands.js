const userOption = (description = "Membre concerné") => ({
  type: 6,
  name: "membre",
  description,
  required: true
});
const reasonOption = (required = true) => ({
  type: 3,
  name: "raison",
  description: "Raison de l'action",
  required
});

export const COMMANDS = [
  { name: "ping", description: "Vérifie la réponse de Gpy." },
  { name: "gpy-prompt", description: "Récupère le prompt à donner à Claude ou à une autre IA." },
  { name: "code", description: "Colle une configuration Gpy générée par une IA." },
  {
    name: "gpy-import",
    description: "Importe un fichier de configuration Gpy plus long.",
    options: [{ type: 11, name: "fichier", description: "Fichier texte .gpy ou .txt", required: true }]
  },
  {
    name: "mod",
    description: "Commandes de modération.",
    options: [
      { type: 1, name: "warn", description: "Enregistre un avertissement.", options: [userOption(), reasonOption()] },
      {
        type: 1,
        name: "timeout",
        description: "Met un membre en pause.",
        options: [
          userOption(),
          { type: 4, name: "minutes", description: "Durée (1 à 40320 minutes)", required: true, min_value: 1, max_value: 40320 },
          reasonOption()
        ]
      },
      { type: 1, name: "kick", description: "Expulse un membre.", options: [userOption(), reasonOption()] },
      { type: 1, name: "ban", description: "Bannit un membre.", options: [userOption(), reasonOption()] },
      {
        type: 1,
        name: "unban",
        description: "Débannit un utilisateur.",
        options: [{ type: 3, name: "identifiant", description: "ID Discord de l'utilisateur", required: true }, reasonOption(false)]
      },
      {
        type: 1,
        name: "clear",
        description: "Supprime les messages récents du salon.",
        options: [{ type: 4, name: "nombre", description: "Nombre de messages (1 à 100)", required: true, min_value: 1, max_value: 100 }]
      },
      { type: 1, name: "lock", description: "Verrouille le salon actuel." },
      { type: 1, name: "unlock", description: "Déverrouille le salon actuel." }
    ]
  },
  {
    name: "ticket",
    description: "Configure et gère les tickets privés.",
    options: [
      { type: 1, name: "panneau", description: "Publie le bouton pour ouvrir un ticket." },
      { type: 1, name: "fermer", description: "Ferme et verrouille le ticket actuel." }
    ]
  },
  { name: "aide", description: "Affiche les commandes de Gpy." }
];

export const PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n,
  MANAGE_ROLES: 1n << 28n,
  MODERATE_MEMBERS: 1n << 40n,
  ADMINISTRATOR: 1n << 3n
};

export function hasPermission(interaction, required) {
  const raw = interaction.member?.permissions || "0";
  let permissions;
  try {
    permissions = BigInt(raw);
  } catch {
    return false;
  }
  return (permissions & PERMISSIONS.ADMINISTRATOR) !== 0n || (permissions & required) === required;
}

export function subcommand(interaction) {
  return interaction.data?.options?.[0]?.name || "";
}

export function optionValue(interaction, name) {
  const options = interaction.data?.options || [];
  const directOption = options.find((option) => option.name === name);
  if (directOption) return directOption.value;
  return options.find((option) => Array.isArray(option.options))?.options?.find((option) => option.name === name)?.value;
}
