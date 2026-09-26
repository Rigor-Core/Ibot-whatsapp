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

  // Devuelve el mensaje del modelo: texto y, si se ofrecieron herramientas,
  // las llamadas que pide (tool_calls).
  async complete({ messages, tools, toolChoice = 'auto', temperature = 0.6, maxTokens = 500, extraBody = {} }) {
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
          ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
          ...extraBody,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || response.statusText;
        throw Object.assign(new Error(`${this.providerName} ${response.status}: ${detail}`), { status: response.status });
      }
      const message = data?.choices?.[0]?.message || {};
      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls.filter((call) => call?.function?.name)
        : [];
      return {
        content: String(message.content || '').trim(),
        toolCalls,
        // DeepSeek con razonamiento pide recibirlo de vuelta junto a las herramientas.
        reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content : null,
      };
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
