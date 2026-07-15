// POST /api/ai — server-side proxy for NVIDIA's OpenAI-compatible NIM API
// (model: z-ai/glm-5.2). The workspace owner's API key lives only here
// (NVIDIA_API_KEY); every visitor's request is proxied through this
// endpoint. Plain requests stream the chat-completion SSE straight through
// unchanged. Requests with `useTools: true` instead run a short, bounded
// function-calling round against the user's connected Composio apps:
// read-only actions execute immediately, anything that mutates something
// outside Zenith is returned as a `proposedAction` for the client to confirm
// before /api/composio?action=execute actually runs it. Dam-guarded so a
// shared key can't be drained by one caller.
const { readBody, parseCookies, clientIp } = require('./_lib/respond');
const { verifySession } = require('./_lib/crypto');
const { guard } = require('./_lib/dam');
const { composioEnabled, isMutating, listUserTools, executeTool, listConnections } = require('./_lib/composio');

const API_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'z-ai/glm-5.2';
const ALLOWED_MODELS = new Set([DEFAULT_MODEL]);

function aiKey() {
  return process.env.NVIDIA_API_KEY || '';
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function toMessages(system, prompt) {
  const messages = [];
  if (system && typeof system === 'string') messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function toOpenAiTools(tools) {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

async function callChat(key, body) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((j && j.error && (j.error.message || j.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return j;
}

function firstToolCall(resp) {
  const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
  const call = msg && Array.isArray(msg.tool_calls) && msg.tool_calls[0];
  if (!call || !call.function) return null;
  let args = {};
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* malformed args from model */ }
  return { id: call.id, name: call.function.name, args };
}

function textOf(resp) {
  const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
  return (msg && msg.content) || '';
}

function humanizeTool(name) {
  return String(name || '').replace(/_/g, ' ').toLowerCase();
}

// ── tool-calling round (non-streaming — needs to inspect the response before deciding what to do) ──
async function handleWithTools(sess, { system, prompt, model }, res) {
  if (!sess) return sendJson(res, 401, { error: 'unauthenticated', message: 'Sign in to use connected apps.' });
  if (!composioEnabled()) return sendJson(res, 503, { error: 'not_configured', message: 'Connected apps are not configured for this workspace yet.' });

  let tools;
  try {
    const conns = await listConnections(sess.email);
    const slugs = [...new Set(conns.map((c) => c.toolkit))];
    tools = await listUserTools(sess.email, slugs);
  } catch (e) {
    return sendJson(res, 502, { error: 'composio', message: e.message || 'Could not reach connected apps.' });
  }
  if (!tools.length) {
    return sendJson(res, 200, { text: "You haven't connected any apps yet — open Settings → Connections to link Gmail, Calendar, Slack and more." });
  }

  const key = aiKey();
  const base = { model, temperature: 0.4, top_p: 1, max_tokens: 4096, tools: toOpenAiTools(tools) };
  const messages = toMessages(system, prompt);

  let resp;
  try {
    resp = await callChat(key, { ...base, messages });
  } catch (e) {
    return sendJson(res, e.status || 502, { error: 'upstream', message: e.message });
  }

  const call = firstToolCall(resp);
  if (!call) {
    return sendJson(res, 200, { text: textOf(resp) || "I couldn't find anything actionable there — try rephrasing." });
  }

  if (isMutating(call.name)) {
    return sendJson(res, 200, { proposedAction: { tool: call.name, args: call.args || {}, description: `Run "${humanizeTool(call.name)}"` } });
  }

  let result;
  try {
    result = await executeTool(call.name, sess.email, call.args || {});
  } catch (e) {
    return sendJson(res, 502, { error: 'composio', message: e.message || 'The connected app did not respond.' });
  }

  const messages2 = [
    ...messages,
    { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args || {}) } }] },
    { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) },
  ];
  let final;
  try {
    final = await callChat(key, { ...base, messages: messages2 });
  } catch (e) {
    return sendJson(res, e.status || 502, { error: 'upstream', message: e.message });
  }
  return sendJson(res, 200, { text: textOf(final) || 'Done.' });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });

  const key = aiKey();
  if (!key) {
    return sendJson(res, 503, { error: 'not_configured', message: 'Zenith AI is not configured for this workspace yet.' });
  }

  // Rate-limit budget tuned for an *interactive* assistant: a work session can
  // fire many completions in a few minutes, so the bucket refills per-minute
  // (not per-hour). Signed-in users get a roomier bucket than anonymous
  // visitors; either way the owner's shared key is still protected from a
  // genuine flood — a runaway client is throttled to the sustained rate, and an
  // exhausted caller only waits a couple of seconds (Retry-After) rather than
  // minutes.
  const sess = verifySession(parseCookies(req).zenith_session);
  const bucketKey = sess ? `ai:user:${sess.email}` : `ai:ip:${clientIp(req)}`;
  const damOpts = sess
    ? { capacity: 60, refillPerSec: 60 / 60 }   // signed-in: 60 burst, ~60/min sustained
    : { capacity: 20, refillPerSec: 20 / 60 };  // guest:     20 burst, ~20/min sustained
  if (!(await guard(req, res, bucketKey, damOpts))) return;

  const { system, prompt, model, useTools } = await readBody(req);
  if (!prompt || typeof prompt !== 'string') {
    return sendJson(res, 400, { error: 'invalid', message: 'Missing prompt.' });
  }
  const useModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;

  if (useTools) return handleWithTools(sess, { system, prompt, model: useModel }, res);

  // ── plain path: stream the chat completion's SSE straight through ──
  const body = {
    model: useModel,
    messages: toMessages(system, prompt),
    temperature: 1,
    top_p: 1,
    max_tokens: 16384,
    seed: 42,
    stream: true,
  };

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch {
    return sendJson(res, 502, { error: 'upstream', message: 'Could not reach the AI service.' });
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 300); } catch { /* unreadable */ }
    return sendJson(res, upstream.status || 502, { error: 'upstream', message: detail || 'The AI service rejected the request.' });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    // client disconnected or upstream dropped mid-stream — nothing more to do
  } finally {
    res.end();
  }
};
