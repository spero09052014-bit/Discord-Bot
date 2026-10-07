const MAX_CONFIG_LENGTH = 20_000;
const MAX_CATEGORIES = 20;
const MAX_CHANNELS = 80;
const MAX_ROLES = 40;

export const GPY_EXAMPLE = [
  "#nom Gpy",
  "#categorie ACCUEIL",
  "#salonordre 1 reglement | type=texte",
  "#salonordre 2 annonces | type=texte",
  "#salonordre 3 nouveaux-arrivants | type=texte",
  "#categorie COMMUNAUTE",
  "#salonordre 1 discussion-generale | type=texte",
  "#salonordre 2 projets-et-reseautage | type=texte",
  "#salonordre 3 salon-principal | type=vocal | limite=0",
  "#categorie IA",
  "#salonordre 1 actualites-ia | type=texte",
  "#salonordre 2 laboratoire-de-prompts | type=texte",
  "#categorie SUPPORT",
  "#salonordre 1 aide-et-bugs | type=texte",
  "#salonordre 2 tickets | type=texte",
  "#categorie MODERATION",
  "#salonordre 1 logs-moderation | type=texte",
  "#role Fondateur | couleur=#6C5CE7",
  "#role Administrateur | couleur=#E74C3C",
  "#role Moderateur | couleur=#3498DB",
  "#role Support | couleur=#00D2D3",
  "#role Developpeur | couleur=#2ECC71",
  "#role Expert IA | couleur=#F1C40F",
  "#role Joueur | couleur=#9B59B6"
].join("\n");

export const AI_PROMPT = [
  "Tu es spécialiste en architecture de serveurs Discord.",
  "Conçois une architecture claire et complète pour le thème que je vais te donner.",
  "Réponds uniquement avec une configuration Gpy v1, sans explication et sans bloc Markdown.",
  "Directives autorisées :",
  "#nom Nom du serveur",
  "#categorie Nom de catégorie",
  "#salonordre 1 nom-du-salon | type=texte",
  "#salonordre 2 salon-vocal | type=vocal | limite=4",
  "#role Nom du rôle | couleur=#3498DB",
  "Les salons doivent suivre une catégorie déclarée juste avant. Les positions commencent à 1.",
  "Utilise des noms de salons courts, en minuscules, sans accents, avec des tirets.",
  "Utilise des noms de rôles clairs en français, avec des couleurs hexadécimales.",
  "N'ajoute aucune permission privilégiée aux rôles et ne crée pas de rôle Administrateur avec des pouvoirs.",
  "Prévois des catégories et salons utiles, mais évite les doublons et les salons vides.",
  "Thème et besoins : [REMPLACE CETTE PHRASE PAR TON IDÉE]"
].join("\n");

function fail(lineNumber, message) {
  throw new Error("Ligne " + lineNumber + " : " + message);
}

function parseOptions(raw, lineNumber) {
  const options = {};
  if (!raw) return options;
  for (const item of raw.split("|").map((part) => part.trim()).filter(Boolean)) {
    const match = item.match(/^([a-z_-]+)\s*=\s*(.+)$/i);
    if (!match) fail(lineNumber, "option invalide « " + item + " ». Utilise cle=valeur.");
    const key = match[1].toLowerCase();
    if (Object.hasOwn(options, key)) fail(lineNumber, "option répétée « " + key + " ».");
    options[key] = match[2].trim();
  }
  return options;
}

function normalizeChannelName(raw, lineNumber) {
  const name = raw
    .trim()
    .replace(/^#/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 100);
  if (!name) fail(lineNumber, "nom de salon vide ou invalide.");
  return name;
}

function validateDisplayName(name, lineNumber, kind) {
  const clean = name.trim();
  if (!clean || clean.length > 100) fail(lineNumber, "le nom " + kind + " doit contenir de 1 à 100 caractères.");
  if (/@everyone|@here/i.test(clean)) fail(lineNumber, "les mentions @everyone et @here ne sont pas autorisées.");
  return clean;
}

export function parseGpyConfig(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Le code Gpy est vide.");
  if (input.length > MAX_CONFIG_LENGTH) throw new Error("Le code dépasse la limite de 20 000 caractères.");

  const config = { name: null, categories: [], roles: [], channelCount: 0 };
  const categoryNames = new Set();
  const roleNames = new Set();
  const channelNames = new Set();
  let currentCategory = null;
  const lines = input.replace(/\r\n?/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim();
    const lineNumber = index + 1;
    if (!line || line.startsWith("//") || line.startsWith(";")) continue;
    if (/^```(?:gpy|text|txt)?$/i.test(line) || line === "```") continue;

    let match = line.match(/^#nom\s+(.+)$/i);
    if (match) {
      if (config.name) fail(lineNumber, "la directive #nom ne peut apparaître qu'une seule fois.");
      config.name = validateDisplayName(match[1], lineNumber, "du serveur");
      continue;
    }

    match = line.match(/^#categorie\s+(.+)$/i);
    if (match) {
      if (config.categories.length >= MAX_CATEGORIES) fail(lineNumber, "maximum de " + MAX_CATEGORIES + " catégories atteint.");
      const name = validateDisplayName(match[1], lineNumber, "de catégorie");
      const key = name.toLocaleLowerCase();
      if (categoryNames.has(key)) fail(lineNumber, "catégorie dupliquée « " + name + " ».");
      categoryNames.add(key);
      currentCategory = { name, channels: [] };
      config.categories.push(currentCategory);
      continue;
    }

    match = line.match(/^#salonordre\s+(\d+)\s+([^|]+?)(?:\s*\|\s*(.*))?$/i);
    if (match) {
      if (!currentCategory) fail(lineNumber, "ajoute une directive #categorie avant #salonordre.");
      if (config.channelCount >= MAX_CHANNELS) fail(lineNumber, "maximum de " + MAX_CHANNELS + " salons atteint.");
      const position = Number(match[1]);
      if (!Number.isSafeInteger(position) || position < 1 || position > 500) {
        fail(lineNumber, "la position du salon doit être comprise entre 1 et 500.");
      }
      if (currentCategory.channels.some((channel) => channel.position === position)) {
        fail(lineNumber, "position " + position + " répétée dans la catégorie « " + currentCategory.name + " ».");
      }
      const name = normalizeChannelName(match[2], lineNumber);
      if (channelNames.has(name)) fail(lineNumber, "nom de salon dupliqué « #" + name + " ».");
      const options = parseOptions(match[3], lineNumber);
      for (const key of Object.keys(options)) {
        if (!["type", "limite"].includes(key)) fail(lineNumber, "option inconnue « " + key + " » pour un salon.");
      }
      const type = (options.type || "texte").toLowerCase();
      if (!["texte", "vocal"].includes(type)) fail(lineNumber, "type doit être texte ou vocal.");
      const userLimit = options.limite === undefined ? 0 : Number(options.limite);
      if (!Number.isInteger(userLimit) || userLimit < 0 || userLimit > 99) {
        fail(lineNumber, "limite doit être un nombre entre 0 et 99.");
      }
      if (type !== "vocal" && options.limite !== undefined) {
        fail(lineNumber, "limite ne s'utilise qu'avec type=vocal.");
      }
      currentCategory.channels.push({ name, type, position, userLimit });
      channelNames.add(name);
      config.channelCount += 1;
      continue;
    }

    match = line.match(/^#role\s+([^|]+?)(?:\s*\|\s*(.*))?$/i);
    if (match) {
      if (config.roles.length >= MAX_ROLES) fail(lineNumber, "maximum de " + MAX_ROLES + " rôles atteint.");
      const name = validateDisplayName(match[1], lineNumber, "de rôle");
      const key = name.toLocaleLowerCase();
      if (roleNames.has(key)) fail(lineNumber, "rôle dupliqué « " + name + " ».");
      const options = parseOptions(match[2], lineNumber);
      for (const option of Object.keys(options)) {
        if (option !== "couleur") fail(lineNumber, "seule l'option couleur est permise pour un rôle.");
      }
      let color = null;
      if (options.couleur !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(options.couleur)) {
          fail(lineNumber, "couleur doit être au format #RRGGBB.");
        }
        color = Number.parseInt(options.couleur.slice(1), 16);
      }
      config.roles.push({ name, color });
      roleNames.add(key);
      continue;
    }

    fail(lineNumber, "directive inconnue. Utilise #nom, #categorie, #salonordre ou #role.");
  }

  if (!config.name) throw new Error("Ajoute une directive #nom, par exemple #nom Gpy.");
  if (!config.categories.length) throw new Error("Ajoute au moins une directive #categorie.");
  if (!config.channelCount) throw new Error("Ajoute au moins une directive #salonordre.");
  return config;
}

export function formatGpyPreview(config) {
  const lines = [
    "**Aperçu Gpy — " + config.name.replace(/[`*_~|]/g, "") + "**",
    config.categories.length + " catégories · " + config.channelCount + " salons · " + config.roles.length + " rôles",
    "Les salons et rôles existants seront conservés ; aucun élément ne sera supprimé.",
    "Les salons portant le même nom pourront être déplacés dans la catégorie indiquée.",
    "Une couleur de rôle indiquée dans le code peut remplacer la couleur actuelle ; aucune permission n'est modifiée.",
    ""
  ];
  for (const category of config.categories.slice(0, 8)) {
    const channelList = category.channels
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((channel) => (channel.type === "vocal" ? "🔊 " : "#") + channel.name)
      .slice(0, 8)
      .join(", ");
    lines.push("**" + category.name.replace(/[`*_~|]/g, "") + "** : " + (channelList || "aucun salon"));
  }
  if (config.categories.length > 8) lines.push("… et " + (config.categories.length - 8) + " catégories supplémentaires.");
  if (config.roles.length) {
    lines.push("");
    lines.push("**Rôles :** " + config.roles.slice(0, 12).map((role) => role.name.replace(/[`*_~|]/g, "")).join(", "));
    if (config.roles.length > 12) lines.push("… et " + (config.roles.length - 12) + " rôles supplémentaires.");
  }
  let output = lines.join("\n");
  if (output.length > 1900) output = output.slice(0, 1850) + "\n… aperçu raccourci.";
  return output;
}
