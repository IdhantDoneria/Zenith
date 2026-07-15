// ─── Zenith AI — thin client for the server-side NVIDIA NIM proxy ───────────
//
// The workspace owner configures NVIDIA_API_KEY once, on the server. Every
// visitor's requests are streamed through /api/ai — no key ever reaches the
// browser. streamCompletion() streams tokens via onToken(fullTextSoFar) and
// resolves with the final text. Aborting the signal resolves with whatever was
// streamed so far (it never throws on user-stop). Failures are mapped to
// friendly AIError messages.

export interface StreamOptions {
  system?: string;
  prompt: string;
  signal: AbortSignal;
  /** called with the FULL accumulated text after each chunk */
  onToken: (full: string) => void;
}

/** User-displayable AI failure. streamCompletion never throws anything else. */
export class AIError extends Error {
  /** true when the workspace owner hasn't set an API key yet — not a user-fixable problem */
  notConfigured?: boolean;
}

const DEFAULT_MODEL = 'z-ai/glm-5.2';

// ─── error mapping ───────────────────────────────────────────────────────────

function friendly(status: number, detail = ''): AIError {
  if (status === 503) {
    const err = new AIError("Zenith AI isn't set up yet — ask the workspace owner to add an API key.");
    err.notConfigured = true;
    return err;
  }
  if (status === 429) {
    return new AIError('Zenith AI is handling a burst of requests — pause a moment and try again.');
  }
  if (status === 404) {
    return new AIError('Model not found — try again shortly.');
  }
  if (status >= 500) {
    return new AIError('The AI service is having a moment — try again shortly.');
  }
  const extra = detail ? ` — ${detail.slice(0, 140)}` : '';
  return new AIError(`AI request failed${status ? ` (HTTP ${status})` : ''}${extra}`);
}

async function httpError(res: Response): Promise<AIError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = String(j?.message ?? j?.error?.message ?? '');
    } catch {
      detail = text.slice(0, 200);
    }
  } catch { /* unreadable body */ }
  return friendly(res.status, detail);
}

function toFriendly(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof TypeError) {
    return new AIError("Couldn't reach Zenith AI — you appear to be offline. Check your connection.");
  }
  if (err instanceof Error && err.name === 'AbortError') return new AIError('Stopped.');
  return new AIError(err instanceof Error ? `AI request failed — ${err.message}` : 'AI request failed.');
}

// ─── SSE reader (`data: {json}` lines, proxied straight through from NVIDIA) ─

async function readSSE(res: Response, onData: (json: any) => void): Promise<void> {
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return; // ignore malformed / partial keep-alives
    }
    onData(json);
  };

  let buf = '';
  const feed = (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  };

  if (!res.body) {
    feed(await res.text());
    handleLine(buf);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
    feed(decoder.decode());
    handleLine(buf); // trailing line without newline
  } catch (e) {
    try { void reader.cancel(); } catch { /* already closed */ }
    throw e;
  }
}

// ─── the proxy call ──────────────────────────────────────────────────────────

async function streamServer(opts: StreamOptions, model: string, acc: { text: string }): Promise<void> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: opts.system, prompt: opts.prompt, model }),
    signal: opts.signal,
  });
  if (!res.ok) throw await httpError(res);

  await readSSE(res, (json) => {
    if (json?.error) throw friendly(Number(json.error.code) || 0, String(json.error.message ?? ''));
    const delta = json?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      acc.text += delta;
      opts.onToken(acc.text);
    }
  });
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Stream a completion from Zenith's AI proxy.
 * Resolves with the final text; if the signal aborts mid-stream, resolves with
 * the partial text instead of throwing. Other failures throw friendly AIErrors.
 */
export async function streamCompletion(opts: StreamOptions): Promise<string> {
  const acc = { text: '' };
  try {
    await streamServer(opts, DEFAULT_MODEL, acc);
  } catch (err) {
    if (opts.signal.aborted) return acc.text; // user pressed Stop — keep partial
    throw toFriendly(err);
  }
  if (!opts.signal.aborted && !acc.text.trim()) {
    throw new AIError('The model returned an empty response — try again.');
  }
  return acc.text;
}
