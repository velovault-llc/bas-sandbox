// LLM assistant store — connection state, message history, current
// streaming response, model + endpoint config. Persisted to localStorage
// so the user's preferred endpoint/model survives a reload.

import { pingOllama, streamChat, type ChatMessage } from './llmClient';
import { BAS_SYSTEM_PROMPT } from './systemPrompt';

export type ConnectionState =
  | { kind: 'unknown' }
  | { kind: 'down' }
  | { kind: 'up'; models: string[] };

export interface Turn {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** When true, this turn is the live-streaming response — UI shows a
   *  caret + adds tokens as they arrive. */
  readonly streaming?: boolean;
  /** Optional error message attached to a failed assistant turn. */
  readonly error?: string;
}

interface LlmStore {
  panelOpen: boolean;
  endpoint: string;
  model: string;
  connection: ConnectionState;
  turns: Turn[];
  /** Active abort controller for the streaming request — null when idle. */
  activeRequest: AbortController | null;
  offsetX: number;
  offsetY: number;
}

const LS_KEYS = {
  endpoint: 'bas-sandbox.llm.endpoint.v1',
  model: 'bas-sandbox.llm.model.v1',
  panelOpen: 'bas-sandbox.llm.open.v1',
  position: 'bas-sandbox.llm.position.v1',
};

function loadString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function loadPosition(): { x: number; y: number } {
  if (typeof localStorage === 'undefined') return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(LS_KEYS.position);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as { x: number; y: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
  } catch {
    // ignore
  }
  return { x: 0, y: 0 };
}

const _initialPos = loadPosition();

export const llmStore = $state<LlmStore>({
  panelOpen: loadBool(LS_KEYS.panelOpen, false),
  endpoint: loadString(LS_KEYS.endpoint, 'http://localhost:11434'),
  // Default model — common 7-8B class that runs comfortably on the
  // user's expected hardware (Ryzen 5 7600 + 16GB VRAM is plenty). If
  // the user pulled a different model, the picker surfaces it.
  model: loadString(LS_KEYS.model, 'llama3.1:8b'),
  connection: { kind: 'unknown' },
  turns: [],
  activeRequest: null,
  offsetX: _initialPos.x,
  offsetY: _initialPos.y,
});

let nextTurnId = 1;

export function togglePanel(): void {
  llmStore.panelOpen = !llmStore.panelOpen;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEYS.panelOpen, llmStore.panelOpen ? '1' : '0');
  } catch {
    // ignore
  }
}

export function setEndpoint(url: string): void {
  llmStore.endpoint = url;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEYS.endpoint, url);
  } catch {
    // ignore
  }
  // Reset connection state so the next ping re-detects.
  llmStore.connection = { kind: 'unknown' };
}

export function setModel(name: string): void {
  llmStore.model = name;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEYS.model, name);
  } catch {
    // ignore
  }
}

export function clearTurns(): void {
  cancelActive();
  llmStore.turns = [];
}

/** Append an assistant turn locally WITHOUT sending anything to the model.
 *  Used for inline help / "you need to open a controller first" notices that
 *  shouldn't pollute the chat history as user prompts the model dutifully
 *  tries to answer. */
export function appendLocalAssistantNotice(text: string): void {
  llmStore.turns = [
    ...llmStore.turns,
    { id: nextTurnId++, role: 'assistant', content: text },
  ];
}

export function cancelActive(): void {
  if (llmStore.activeRequest) {
    llmStore.activeRequest.abort();
    llmStore.activeRequest = null;
    // Mark the in-flight assistant turn (if any) as finished/cancelled.
    const last = llmStore.turns[llmStore.turns.length - 1];
    if (last && last.role === 'assistant' && last.streaming) {
      llmStore.turns = [
        ...llmStore.turns.slice(0, -1),
        { ...last, streaming: false, content: last.content + (last.content ? '\n\n' : '') + '_(cancelled)_' },
      ];
    }
  }
}

/** Ping the configured endpoint and update connection state. Safe to
 *  call on a polling schedule. */
export async function refreshConnection(): Promise<void> {
  const ping = await pingOllama(llmStore.endpoint);
  llmStore.connection = ping === null ? { kind: 'down' } : { kind: 'up', models: ping.models };
}

/** Send a user message; the assistant turn streams in real-time and
 *  appears in the turns array as it goes. */
export function sendMessage(userText: string): void {
  if (llmStore.connection.kind !== 'up') {
    llmStore.turns = [
      ...llmStore.turns,
      {
        id: nextTurnId++,
        role: 'assistant',
        content: `Ollama isn't reachable at ${llmStore.endpoint}. Start it with:\n\n    docker run -d --name ollama -p 11434:11434 ollama/ollama\n    docker exec ollama ollama pull ${llmStore.model}\n\nThen click the connection pill to retry.`,
        error: 'connection-down',
      },
    ];
    return;
  }
  cancelActive();
  const userTurn: Turn = {
    id: nextTurnId++,
    role: 'user',
    content: userText,
  };
  const asstTurn: Turn = {
    id: nextTurnId++,
    role: 'assistant',
    content: '',
    streaming: true,
  };
  llmStore.turns = [...llmStore.turns, userTurn, asstTurn];

  // Build the message list from prior turns (excluding the placeholder
  // assistant turn we just appended).
  const history: ChatMessage[] = llmStore.turns
    .slice(0, -1)
    .filter((t) => !t.error)
    .map((t) => ({ role: t.role, content: t.content }));

  const ac = streamChat(
    llmStore.endpoint,
    llmStore.model,
    BAS_SYSTEM_PROMPT,
    history,
    {
      onToken: (text) => {
        const turns = llmStore.turns;
        const last = turns[turns.length - 1];
        if (!last || last.role !== 'assistant' || !last.streaming) return;
        llmStore.turns = [...turns.slice(0, -1), { ...last, content: last.content + text }];
      },
      onDone: () => {
        const turns = llmStore.turns;
        const last = turns[turns.length - 1];
        if (!last || last.role !== 'assistant' || !last.streaming) return;
        llmStore.turns = [...turns.slice(0, -1), { ...last, streaming: false }];
        llmStore.activeRequest = null;
      },
      onError: (err) => {
        const turns = llmStore.turns;
        const last = turns[turns.length - 1];
        if (!last || last.role !== 'assistant' || !last.streaming) return;
        llmStore.turns = [
          ...turns.slice(0, -1),
          { ...last, streaming: false, error: err.message, content: last.content + (last.content ? '\n\n' : '') + `_(error: ${err.message})_` },
        ];
        llmStore.activeRequest = null;
      },
    },
  );
  llmStore.activeRequest = ac;
}

// ── Panel positioning (same pattern as runtime / packet log panels) ──

// Loose backstop only — the precise, canvas-area-aware clamp lives in
// LlmAssistantPanel's clampPos() and runs after this on mount / resize /
// drag-end. 360px (measured against window height, not the canvas area)
// stranded the panel mid-screen on short laptop viewports; 120px lets the
// component clamp be the binding constraint so the panel reaches the top.
const PANEL_MIN_HEADER_VISIBLE = 120;

function clampToViewport(x: number, y: number): { cx: number; cy: number } {
  if (typeof window === 'undefined') return { cx: Math.max(0, x), cy: Math.max(0, y) };
  const maxY = Math.max(0, window.innerHeight - PANEL_MIN_HEADER_VISIBLE);
  const maxX = Math.max(0, window.innerWidth - PANEL_MIN_HEADER_VISIBLE);
  return { cx: Math.min(maxX, Math.max(0, x)), cy: Math.min(maxY, Math.max(0, y)) };
}

export function setPanelPosition(x: number, y: number): void {
  const { cx, cy } = clampToViewport(x, y);
  llmStore.offsetX = cx;
  llmStore.offsetY = cy;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEYS.position, JSON.stringify({ x: cx, y: cy }));
  } catch {
    // ignore
  }
}

export function resetPanelPosition(): void {
  setPanelPosition(0, 0);
}

export function rehydratePanelPosition(): void {
  const { cx, cy } = clampToViewport(llmStore.offsetX, llmStore.offsetY);
  if (cx !== llmStore.offsetX || cy !== llmStore.offsetY) setPanelPosition(cx, cy);
}
