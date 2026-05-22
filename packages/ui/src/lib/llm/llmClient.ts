// Ollama HTTP client. Streaming chat completions over localhost.
//
// We use Ollama's native /api/chat endpoint (NOT the OpenAI-compatible
// /v1/chat/completions) because:
//   1. Native endpoint streams as newline-delimited JSON which is easier
//      to parse without a heavy SSE library.
//   2. We get model-load progress events when the model isn't in memory
//      yet, which lets us show a "loading model…" state in the UI.
//   3. The native endpoint takes our system prompt as a top-level field
//      rather than a magic message role, which is friendlier to local
//      models that don't have strong system-message training.
//
// All requests are unauthenticated localhost — no API key, no CORS
// drama as long as Ollama is bound to 127.0.0.1.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatStreamHandlers {
  onToken: (text: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

/** Check whether an Ollama instance is reachable at the given base URL.
 *  Returns the model list on success, null on any failure. Never throws —
 *  this is meant for status-pill polling that runs every few seconds. */
export async function pingOllama(baseUrl: string): Promise<{ models: string[] } | null> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      // Reasonably aggressive timeout — if it's not localhost-fast,
      // assume it's down rather than blocking the UI.
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { models?: Array<{ name: string }> };
    return { models: (body.models ?? []).map((m) => m.name) };
  } catch {
    return null;
  }
}

/** Issue a streaming chat request to Ollama. Returns an AbortController
 *  the caller can use to cancel mid-stream. */
export function streamChat(
  baseUrl: string,
  model: string,
  system: string,
  messages: ChatMessage[],
  handlers: ChatStreamHandlers,
): AbortController {
  const ac = new AbortController();
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const body = {
    model,
    messages,
    stream: true,
    // Ollama's native endpoint accepts `system` as a top-level field.
    // It threads it in as the model's system message regardless of
    // chat template — friendlier to small local models.
    options: {
      // 4K context is the safe default across the 7-8B model class.
      // Bigger contexts (32K+) are model-dependent; we'd need to expose
      // this as a per-model setting later.
      num_ctx: 4096,
      // Mild temperature — factual answers, not creative writing.
      temperature: 0.3,
    },
    system,
  };

  // We can't await this in an effect; fire-and-forget with the handlers.
  void (async () => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => '<unreadable>');
        handlers.onError?.(new Error(`Ollama returned ${r.status}: ${errBody}`));
        return;
      }
      const reader = r.body?.getReader();
      if (!reader) {
        handlers.onError?.(new Error('Ollama response had no body stream'));
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Ollama emits one JSON object per line. Split on newlines and
        // parse each complete line; keep the trailing partial in buffer.
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as {
              message?: { content?: string };
              done?: boolean;
              error?: string;
            };
            if (obj.error) {
              handlers.onError?.(new Error(`Ollama error: ${obj.error}`));
              return;
            }
            if (obj.message?.content) handlers.onToken(obj.message.content);
            if (obj.done) {
              handlers.onDone?.();
              return;
            }
          } catch {
            // Partial / malformed line — Ollama doesn't normally send these,
            // but if it does we skip rather than aborting the whole stream.
          }
        }
      }
      handlers.onDone?.();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return ac;
}
