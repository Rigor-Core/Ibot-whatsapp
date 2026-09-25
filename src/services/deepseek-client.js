const DEFAULT_BASE_URL = 'https://dipisik.rigorcore.com/v1';

export class DeepSeekClient {
  constructor({ apiKey, baseUrl, model, timeoutMs = 20000 }) {
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = String(model || 'deepseek-chat').trim();
    this.timeoutMs = Math.min(Math.max(Number(timeoutMs) || 20000, 1000), 120000);
  }

  async chat({ messages, temperature = 0.6, maxTokens = 500 }) {
    if (!this.apiKey) throw new Error('DEEPSEEK_API_KEY no configurada');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || response.statusText;
        throw new Error(`DeepSeek ${response.status}: ${detail}`);
      }
      return String(data?.choices?.[0]?.message?.content || '').trim();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La solicitud a DeepSeek excedió el tiempo máximo', { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
