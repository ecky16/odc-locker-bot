const api = (m, token) => `https://api.telegram.org/bot${token}/${m}`;


export async function sendMessage(token, chatId, text, extra = {}) {
const body = new URLSearchParams({ chat_id: String(chatId), text, ...extra });
const res = await fetch(api("sendMessage", token), { method: "POST", body });
try { return await res.json(); } catch { return { ok: false }; }
}
