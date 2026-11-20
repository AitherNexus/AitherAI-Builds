(() => {
  "use strict";
  const base = String(window.AitherConfig?.backendUrl || "").replace(/\/+$/, "");
  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.detail || data.error?.message || data.message || ("AitherBackend request failed (" + response.status + ").");
      throw new Error(String(message));
    }
    return data;
  }
  async function models() {
    const response = await fetch(base + "/api/ai/models", {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    return readJson(response);
  }
  async function chat({ provider, model, messages, stream = false }) {
    const response = await fetch(base + "/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ provider, model, messages })
    });
    const data = await readJson(response);
    const content = String(data.reply || "");
    if (!content.trim()) throw new Error("AitherBackend returned an empty AI response.");
    const normalized = {
      id: "aither-" + Date.now(),
      object: "chat.completion",
      model: data.model || model || "auto",
      provider: data.provider || provider,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
    };
    if (!stream) {
      return new Response(JSON.stringify(normalized), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    const chunk = {
      id: normalized.id,
      object: "chat.completion.chunk",
      model: normalized.model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }]
    };
    const body = "data: " + JSON.stringify(chunk) + "\n\ndata: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
    });
  }
  async function health() {
    const response = await fetch(base + "/healthz", { cache: "no-store" });
    return readJson(response);
  }
  window.AitherAPI = Object.freeze({ models, chat, health });
})();
