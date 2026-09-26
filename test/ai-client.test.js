import test from 'node:test';
import assert from 'node:assert/strict';
import { AiChatClient } from '../src/services/ai-client.js';

test('envía solicitudes en formato chat/completions con campos extra del proveedor', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: '  Respuesta del modelo  ' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new AiChatClient({
      apiKey: 'test-key',
      baseUrl: 'https://dipisik.rigorcore.com/v1/',
      model: 'deepseek-chat',
    });
    const answer = await client.complete({
      messages: [{ role: 'user', content: 'Hola' }],
      temperature: 0.2,
      maxTokens: 120,
      extraBody: { profile: 'whatsapp' },
    });

    assert.equal(answer.content, 'Respuesta del modelo');
    assert.deepEqual(answer.toolCalls, []);
    assert.equal(request.url, 'https://dipisik.rigorcore.com/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(request.options.body), {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hola' }],
      temperature: 0.2,
      max_tokens: 120,
      stream: false,
      profile: 'whatsapp',
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
    const client = new AiChatClient({ apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/v1', providerName: 'DeepSeek' });
    await assert.rejects(
      client.complete({ messages: [] }),
      /DeepSeek 429: Modelo no disponible/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ofrece herramientas y devuelve las llamadas que pide el modelo', async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'buscar', arguments: '{"q":"x"}' } }] } }],
    }), { status: 200 });
  };
  try {
    const client = new AiChatClient({ apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
    const tools = [{ type: 'function', function: { name: 'buscar', parameters: { type: 'object', properties: {} } } }];
    const answer = await client.complete({ messages: [{ role: 'user', content: 'hola' }], tools });
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.tools.length, 1);
    assert.equal(answer.content, '');
    assert.equal(answer.toolCalls[0].function.name, 'buscar');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
