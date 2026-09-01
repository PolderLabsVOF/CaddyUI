import dns from 'node:dns/promises';
import net from 'node:net';

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.internal', 'instance-data.ec2.internal']);

function privateAddress(address = '') {
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
  }
  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  return false;
}

function blockedMetadataAddress(address = '') {
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 169 && parts[1] === 254;
  }
  return net.isIP(address) === 6 && address.toLowerCase().startsWith('fe80:');
}

export async function validateAiBaseUrl(value, { allowPrivate = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('AI base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('AI base URL must use http or https.');
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(hostname) || hostname.endsWith('.internal') && hostname.includes('metadata')) throw new Error('Cloud metadata endpoints are not allowed.');
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('AI base URL hostname did not resolve.');
  if (addresses.some(({ address }) => blockedMetadataAddress(address))) throw new Error('Link-local and metadata endpoints are not allowed.');
  if (!allowPrivate && addresses.some(({ address }) => privateAddress(address))) throw new Error('Private/local AI URLs require explicit acknowledgement.');
  if (parsed.protocol !== 'https:' && !addresses.every(({ address }) => privateAddress(address))) throw new Error('Public AI base URLs must use HTTPS.');
  return parsed;
}

function providerEndpoint(baseUrl, provider) {
  const parsed = new URL(baseUrl);
  const expected = provider === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
  const suffix = provider === 'anthropic' ? '/messages' : '/chat/completions';
  if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = expected;
  else if (!parsed.pathname.endsWith(expected) && !parsed.pathname.endsWith(suffix)) {
    parsed.pathname = parsed.pathname.replace(/\/$/, '').endsWith('/v1')
      ? `${parsed.pathname.replace(/\/$/, '')}${suffix}`
      : `${parsed.pathname.replace(/\/$/, '')}${expected}`;
  }
  return parsed.toString();
}

async function readProviderResponse(response) {
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('AI provider response exceeded the size limit.');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return { data: parseSseStream(text), streamed: true };
  }
  if (!text) return { data: {}, streamed: false };
  try {
    return { data: JSON.parse(text), streamed: false };
  } catch {
    throw new Error(`AI provider returned invalid JSON (${response.status}).`);
  }
}

function parseSseStream(body) {
  const aggregated = {
    id: '',
    object: 'chat.completion',
    model: '',
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: null }],
    usage: null,
  };
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    if (event.id && !aggregated.id) aggregated.id = event.id;
    if (event.model && !aggregated.model) aggregated.model = event.model;
    const choice = Array.isArray(event.choices) ? event.choices[0] : null;
    if (!choice) continue;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') {
      aggregated.choices[0].message.content = (aggregated.choices[0].message.content || '') + delta.content;
    } else if (Array.isArray(delta.content)) {
      const text = delta.content.filter((part) => part?.type === 'text' || typeof part?.text === 'string').map((part) => part.text || '').join('');
      if (text) aggregated.choices[0].message.content = (aggregated.choices[0].message.content || '') + text;
    }
    if (Array.isArray(delta.tool_calls)) {
      aggregated.choices[0].message.tool_calls = aggregated.choices[0].message.tool_calls || [];
      for (const call of delta.tool_calls) {
        const existing = aggregated.choices[0].message.tool_calls[call.index ?? 0];
        if (existing) {
          if (call.function?.arguments) existing.function.arguments = (existing.function.arguments || '') + (call.function.arguments || '');
        } else {
          aggregated.choices[0].message.tool_calls[call.index ?? aggregated.choices[0].message.tool_calls.length] = {
            id: call.id || '',
            type: call.type || 'function',
            function: { name: call.function?.name || '', arguments: call.function?.arguments || '' },
          };
        }
      }
    }
    if (choice.finish_reason) aggregated.choices[0].finish_reason = choice.finish_reason;
    if (event.usage) aggregated.usage = event.usage;
  }
  if (aggregated.choices[0].message.tool_calls) {
    aggregated.choices[0].message.tool_calls = aggregated.choices[0].message.tool_calls.filter(Boolean);
  }
  return aggregated;
}

function openAiTools(tools = []) {
  return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
}

export async function callAiProvider({ provider, baseUrl, apiKey, model, system, messages, tools = [], signal }) {
  const endpoint = providerEndpoint(baseUrl, provider);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let body;
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: 1600, system, messages, tools, tool_choice: { type: 'auto' } };
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model,
      max_tokens: 1600,
      stream: false,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: openAiTools(tools),
      tool_choice: 'auto',
    };
  }
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
  const { data } = await readProviderResponse(response);
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `AI provider request failed (${response.status}).`;
    throw new Error(String(message).slice(0, 500));
  }
  if (provider === 'anthropic') {
    const content = Array.isArray(data.content) ? data.content : [];
    return {
      text: content.filter((block) => block?.type === 'text').map((block) => block.text || '').join(''),
      toolCalls: content.filter((block) => block?.type === 'tool_use').map((block) => ({ id: block.id, name: block.name, input: block.input || {} })),
      raw: data,
    };
  }
  const message = data?.choices?.[0]?.message || {};
  return {
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls: (message.tool_calls || []).map((call) => {
      let input = {};
      try { input = JSON.parse(call?.function?.arguments || '{}'); } catch {}
      return { id: call.id, name: call?.function?.name, input };
    }),
    raw: data,
  };
}
