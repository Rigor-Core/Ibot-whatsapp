// Cliente para cualquier API compatible con el formato chat/completions de OpenAI
// (Dipisik, DeepSeek, OpenAI, Z.ai, Gemini, Groq, OpenRouter, Ollama, etc.).
export class AiChatClient {
  constructor({ apiKey, baseUrl, model, timeoutMs = 20000, providerName = 'IA' }) {
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.model = String(model || '').trim();
    this.timeoutMs = Math.min(Math.max(Number(timeoutMs) || 20000, 1000), 120000);
    this.providerName = providerName;
  }

  async chat({ messages, temperature = 0.6, maxTokens = 500, extraBody = {} }) {
    if (!this.baseUrl) throw new Error(`${this.providerName}: falta la URL base`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
          ...extraBody,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || response.statusText;
        throw new Error(`${this.providerName} ${response.status}: ${detail}`);
      }
      return String(data?.choices?.[0]?.message?.content || '').trim();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${this.providerName}: la solicitud excedió el tiempo máximo`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
