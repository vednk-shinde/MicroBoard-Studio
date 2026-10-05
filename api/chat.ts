// MicroBot, the MicroBoard Studio assistant: a Vercel serverless function that answers questions with Claude.
// The API key stays here on the server (Vercel env var ANTHROPIC_API_KEY); without it the
// web app falls back to its built-in answers.
import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT } from './_systemPrompt.js'

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const MODEL = 'claude-opus-5-5'
const MAX_TURNS = 12
const MAX_MESSAGE_CHARS = 4000
const MAX_CONTEXT_CHARS = 12000
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 8 }

// Prefix that tells the web app the AI couldn't answer, so it shows a built-in answer instead.
const FAILURE_MARKER = '\u0000'

// Best-effort per-IP limit (per server instance) to keep a public site's API bill in check.
const recentRequests = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (recentRequests.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT.windowMs)
  recent.push(now)
  recentRequests.set(ip, recent)
  return recent.length > RATE_LIMIT.maxRequests
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function parseBody(body: unknown): { turns: ChatTurn[]; context: string } | null {
  if (!body || typeof body !== 'object') return null
  const { messages, context } = body as { messages?: unknown; context?: unknown }
  if (!Array.isArray(messages) || messages.length === 0) return null
  const turns = messages.slice(-MAX_TURNS).map((message) => {
    const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return null
    return { role, content: content.slice(0, MAX_MESSAGE_CHARS) } as ChatTurn
  })
  if (turns.some((turn) => turn === null)) return null
  const valid = turns as ChatTurn[]
  // The conversation must start and end with the user.
  while (valid.length && valid[0].role !== 'user') valid.shift()
  if (!valid.length || valid[valid.length - 1].role !== 'user') return null
  return { turns: valid, context: typeof context === 'string' ? context.slice(0, MAX_CONTEXT_CHARS) : '' }
}

function friendlyError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'auth'
  if (error instanceof Anthropic.RateLimitError) return 'busy'
  if (error instanceof Anthropic.APIError) return `api_${error.status ?? 'error'}`
  return 'network'
}

// Lets the web app check whether AI mode is configured before the first question.
export function GET(): Response {
  return json({ ai: Boolean(process.env.ANTHROPIC_API_KEY) })
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) return json({ error: 'rate_limited' }, 429)

  let parsed: ReturnType<typeof parseBody>
  try {
    parsed = parseBody(await request.json())
  } catch {
    parsed = null
  }
  if (!parsed) return json({ error: 'bad_request' }, 400)

  const { turns, context } = parsed
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((turn, index) => {
    const isLast = index === turns.length - 1
    const content = isLast && context ? `<app_context>\n${context}\n</app_context>\n\n${turn.content}` : turn.content
    return { role: turn.role, content }
  })

  const client = new Anthropic()
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    // If a safety classifier declines, retry on Anthropic's recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // Low effort keeps chat replies fast; the knowledge in the system prompt carries the accuracy.
    output_config: { effort: 'low' },
    // The large, fixed knowledge prompt is cached, so repeat questions cost much less.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
  })

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentText = false
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            sentText = true
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        const final = await stream.finalMessage()
        if (final.stop_reason === 'refusal') {
          controller.enqueue(encoder.encode(sentText ? '\n\n(I had to stop there.)' : `${FAILURE_MARKER}refusal`))
        } else if (final.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n(The answer was cut short. Ask me to continue.)'))
        }
      } catch (error) {
        console.error('assistant error', error)
        controller.enqueue(encoder.encode(sentText ? '\n\n(The connection was interrupted.)' : `${FAILURE_MARKER}${friendlyError(error)}`))
      } finally {
        controller.close()
      }
    },
    cancel() {
      stream.abort()
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Assistant-Mode': 'ai' },
  })
}
