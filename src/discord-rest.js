const API_BASE = "https://discord.com/api/v10";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function discordRequest(path, { method = "GET", body, reason } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN n'est pas configuré dans les secrets Render.");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const headers = { authorization: "Bot " + token };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (reason) headers["x-audit-log-reason"] = encodeURIComponent(reason.slice(0, 512));
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      if (attempt === 4) throw new Error("Discord est momentanément inaccessible : " + error.message);
      await wait(300 * (attempt + 1));
      continue;
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 200) };
      }
    }
    if (response.status === 429 && attempt < 4) {
      const delay = Math.min(30_000, Math.max(250, Number(data?.retry_after || 1) * 1000));
      await wait(delay);
      continue;
    }
    if (!response.ok) {
      const error = new Error("Discord API (" + response.status + ") : " + (data?.message || response.statusText));
      error.status = response.status;
      throw error;
    }
    return data;
  }
  throw new Error("Discord a limité trop de requêtes ; réessaie dans un instant.");
}

export async function editInteractionResponse(interaction, payload) {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const token = interaction.token;
  if (!applicationId || !token) throw new Error("Impossible de mettre à jour la réponse Discord.");
  const response = await fetch(
    API_BASE + "/webhooks/" + encodeURIComponent(applicationId) + "/" + encodeURIComponent(token) + "/messages/@original",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000)
    }
  );
  if (!response.ok) throw new Error("La réponse différée Discord a expiré.");
}

export function auditReason(reason) {
  return (reason || "Action Gpy").replace(/[\r\n]/g, " ").slice(0, 400);
}
