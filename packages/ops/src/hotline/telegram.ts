// Minimal Telegram Bot API client for long polling (no webhook, no server). Plain fetch, no library.
// The bot token only ever appears inside request URLs; every error message is scrubbed of it.

export type TgPhotoSize = { file_id: string; file_size?: number; width: number; height: number };
export type TgMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: { file_id: string; mime_type?: string; file_size?: number; file_name?: string };
};
export type TgUpdate = { update_id: number; message?: TgMessage };

export interface TelegramApi {
  getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]>;
  sendMessage(chatId: number | string, text: string, replyTo?: number): Promise<void>;
  downloadFile(fileId: string): Promise<Uint8Array>;
}

export function scrubToken(text: string, token: string): string {
  return token ? text.split(token).join("<token>") : text;
}

export function telegramApi(token: string, fetchImpl: typeof fetch = globalThis.fetch): TelegramApi {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("TELEGRAM_BOT_TOKEN does not look like a bot token (expected 123456:ABC…)");
  const base = `https://api.telegram.org/bot${token}`;

  async function call<T>(method: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Telegram ${method}: network error (${scrubToken((e as Error).message, token)})`);
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.error_code ?? res.status} ${scrubToken(json.description ?? res.statusText, token)}`);
    return json.result as T;
  }

  return {
    getUpdates: (offset, timeoutSec) => call<TgUpdate[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] }),
    sendMessage: async (chatId, text, replyTo) => {
      await call("sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
    },
    downloadFile: async (fileId) => {
      const f = await call<{ file_path?: string }>("getFile", { file_id: fileId });
      if (!f.file_path) throw new Error("Telegram getFile returned no file_path (file too large for the Bot API?)");
      let res: Response;
      try {
        res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
      } catch (e) {
        throw new Error(`Telegram file download: network error (${scrubToken((e as Error).message, token)})`);
      }
      if (!res.ok) throw new Error(`Telegram file download failed: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
