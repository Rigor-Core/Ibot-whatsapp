import { completeIa } from '../../services/ai-providers.js';

const MAX_TOOL_RESULT_CHARS = 12000;
const TOOLS_RETRY_MS = 60 * 60 * 1000;
// Modelos que rechazaron herramientas: se usan sin ellas durante un rato.
const withoutTools = new Map();

function isToolsRejection(error) {
  return [400, 404, 422].includes(error?.status) && /tool|function/i.test(error.message);
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Conversación con herramientas: el modelo puede pedir datos (buscar en el
// historial, Todoist, enviar un sticker...) varias veces antes de responder.
// Si el proveedor no admite herramientas, responde sin ellas.
export async function runAgent({ ia, settings, accountId, messages, tools = [], executeTool, temperature, onStep }) {
  const modelKey = `${ia.provider}|${ia.model}|${ia.baseUrl}`;
  let useTools = tools.length > 0 && !((withoutTools.get(modelKey) || 0) > Date.now());
  const conversation = [...messages];
  const steps = [];

  for (let step = 0; step <= ia.maxToolSteps; step += 1) {
    const offerTools = useTools && step < ia.maxToolSteps;
    // En el último paso las herramientas siguen declaradas (el historial ya
    // tiene llamadas) pero el modelo debe responder con texto.
    const usedTools = useTools && steps.length > 0;
    let reply;
    try {
      reply = await completeIa(ia, settings, {
        messages: conversation,
        tools: offerTools || usedTools ? tools : undefined,
        toolChoice: offerTools ? 'auto' : 'none',
        temperature,
      }, accountId);
    } catch (error) {
      if (!offerTools || !isToolsRejection(error)) throw error;
      withoutTools.set(modelKey, Date.now() + TOOLS_RETRY_MS);
      useTools = false;
      step -= 1;
      continue;
    }

    if (!offerTools || !reply.toolCalls.length) return { text: reply.content, steps };

    conversation.push({
      role: 'assistant',
      content: reply.content || '',
      tool_calls: reply.toolCalls,
      ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
    });
    for (const call of reply.toolCalls) {
      const name = call.function.name;
      const args = parseArguments(call.function.arguments);
      let result;
      try {
        result = await executeTool(name, args);
      } catch (error) {
        result = { error: error.message };
      }
      const entry = { tool: name, args, ok: !result?.error };
      steps.push(entry);
      onStep?.(entry);
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result ?? null).slice(0, MAX_TOOL_RESULT_CHARS),
      });
    }
  }
  return { text: '', steps };
}
