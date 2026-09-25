import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekClient } from '../src/services/deepseek-client.js';

test('envía solicitudes en el formato compatible con DeepSeek', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: '  Respuesta del modelo  ' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new DeepSeekClient({
      apiKey: 'test-key',
      baseUrl: 'https://dipisik.rigorcore.com/v1/',
      model: 'deepseek-chat',
    });
    const answer = await client.chat({
      messages: [{ role: 'user', content: 'Hola' }],
      temperature: 0.2,
      maxTokens: 120,
    });

    assert.equal(answer, 'Respuesta del modelo');
    assert.equal(request.url, 'https://dipisik.rigorcore.com/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(request.options.body), {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hola' }],
      temperature: 0.2,
      max_tokens: 120,
      stream: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('incluye el detalle de errores del servicio', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: 'Modelo no disponible' },
  }), { status: 429, statusText: 'Too Many Requests', headers: { 'Content-Type': 'application/json' } });

  try {
    const client = new DeepSeekClient({ apiKey: 'test-key' });
    await assert.rejects(
      client.chat({ messages: [] }),
      /DeepSeek 429: Modelo no disponible/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
