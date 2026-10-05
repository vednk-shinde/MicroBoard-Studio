import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, MessageCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { answerLocally, SUGGESTED_QUESTIONS } from '../assistant/knowledge'
import { COMPONENT_LESSONS } from '../data/componentLessons'
import type { ProjectComponent } from '../sim/componentDetection'
import './ChatAssistant.css'

type ChatMessage = { role: 'user' | 'assistant'; text: string; mode?: 'ai' | 'local'; related?: string[] }

type ChatAssistantProps = {
  pageLabel: string
  parts: ProjectComponent[]
}

const SKETCH_STORAGE_KEY = 'microboard.sketch.v1'
const FAILURE_MARKER = '\u0000'

function currentSketch(): string {
  try {
    return localStorage.getItem(SKETCH_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function buildContext(pageLabel: string, parts: ProjectComponent[]): string {
  const components = parts.length
    ? parts.map((part) => `${COMPONENT_LESSONS[part.id].name}${part.pins.length ? ` (${part.pins.map((pin) => `${pin.role}=${pin.pin}`).join(', ')})` : ''}`).join('; ')
    : 'none detected yet'
  const sketch = currentSketch().slice(0, 8000)
  return `Current page: ${pageLabel}\nProject components: ${components}\nSketch in the Code Visualizer editor:\n${sketch || '(empty)'}`
}

// ---- minimal, safe formatting: **bold**, `code`, fenced code blocks, "- " / "1. " lists

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  text.split(/```[a-zA-Z]*\n?/).forEach((chunk, chunkIndex) => {
    if (chunkIndex % 2 === 1) {
      blocks.push(<pre key={`code-${chunkIndex}`}><code>{chunk.replace(/\n$/, '')}</code></pre>)
      return
    }
    let list: { ordered: boolean; items: string[] } | null = null
    const flush = (key: string) => {
      if (!list) return
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>)
      blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>)
      list = null
    }
    chunk.split('\n').forEach((line, lineIndex) => {
      const key = `${chunkIndex}-${lineIndex}`
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
      if (bullet || numbered) {
        const ordered = Boolean(numbered)
        if (list && list.ordered !== ordered) flush(`list-${key}`)
        if (!list) list = { ordered, items: [] }
        list.items.push((bullet ?? numbered)![1])
        return
      }
      flush(`list-${key}`)
      if (line.trim()) blocks.push(<p key={key}>{inline(line)}</p>)
    })
    flush(`list-end-${chunkIndex}`)
  })
  return <>{blocks}</>
}

export function ChatAssistant({ pageLabel, parts }: ChatAssistantProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Ask the server once whether AI mode is configured (no API key → built-in answers).
  useEffect(() => {
    if (!open || aiAvailable !== null) return
    let cancelled = false
    fetch('/api/chat', { method: 'GET' })
      .then(async (response) => {
        const data = response.ok && response.headers.get('content-type')?.includes('application/json') ? await response.json() as { ai?: boolean } : null
        if (!cancelled) setAiAvailable(Boolean(data?.ai))
      })
      .catch(() => { if (!cancelled) setAiAvailable(false) })
    return () => { cancelled = true }
  }, [open, aiAvailable])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, open])

  function answerOffline(question: string) {
    const answer = answerLocally(question)
    setMessages((current) => [...current.filter((message) => message.text !== ''), { role: 'assistant', text: answer.text, mode: 'local', related: answer.related }])
  }

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    const history = [...messages, { role: 'user' as const, text }]
    setMessages(history)
    setInput('')

    if (aiAvailable !== true) {
      answerOffline(text)
      return
    }

    setBusy(true)
    setMessages((current) => [...current, { role: 'assistant', text: '', mode: 'ai' }])
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-12).map((message) => ({ role: message.role, content: message.text })),
          context: buildContext(pageLabel, parts),
        }),
      })
      if (!response.ok || response.headers.get('X-Assistant-Mode') !== 'ai' || !response.body) {
        if (response.status === 503) setAiAvailable(false)
        answerOffline(text)
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let received = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += decoder.decode(value, { stream: true })
        if (received.startsWith(FAILURE_MARKER)) continue
        const partial = received
        setMessages((current) => [...current.slice(0, -1), { role: 'assistant', text: partial, mode: 'ai' }])
      }
      if (!received.trim() || received.startsWith(FAILURE_MARKER)) answerOffline(text)
    } catch {
      answerOffline(text)
    } finally {
      setBusy(false)
    }
  }

  const modeLabel = aiAvailable ? 'AI' : 'Built-in answers'

  return (
    <>
      {!open && (
        <button type="button" className="chat-launcher" onClick={() => setOpen(true)} aria-label="Open the MicroBoard assistant">
          <MessageCircle size={20} /><span>Ask MicroBoard</span>
        </button>
      )}
      {open && (
        <section className="chat-panel" role="dialog" aria-label="MicroBoard assistant">
          <header className="chat-header">
            <span className="chat-avatar"><Bot size={17} /></span>
            <div>
              <strong>MicroBoard assistant</strong>
              <small className={aiAvailable ? 'is-ai' : ''}>{aiAvailable ? <Sparkles size={11} /> : null}{aiAvailable === null ? 'Connecting…' : modeLabel}</small>
            </div>
            {messages.length > 0 && <button type="button" className="chat-icon-button" onClick={() => setMessages([])} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>}
            <button type="button" className="chat-icon-button" onClick={() => setOpen(false)} aria-label="Close the assistant" title="Close"><X size={17} /></button>
          </header>

          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <p>Hi! Ask me anything about MicroBoard Studio: the pages, the simulator, connecting your Arduino, pins and registers, or the components in your project.</p>
                <div className="chat-suggestions">
                  {SUGGESTED_QUESTIONS.map((question) => <button type="button" key={question} onClick={() => void ask(question)}>{question}</button>)}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`chat-message is-${message.role}`}>
                {message.role === 'assistant' && message.text === '' ? <span className="chat-typing" aria-label="Thinking"><i /><i /><i /></span> : <RichText text={message.text} />}
                {message.role === 'assistant' && message.related && message.related.length > 0 && index === messages.length - 1 && (
                  <div className="chat-suggestions is-related">
                    {message.related.map((question) => <button type="button" key={question} onClick={() => void ask(question)}>{question}</button>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form className="chat-input" onSubmit={(event) => { event.preventDefault(); void ask(input) }}>
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              maxLength={2000}
              placeholder="Ask about the project…"
              aria-label="Your question"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(input) }
              }}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
          </form>
          <p className="chat-footnote">{aiAvailable ? 'AI answers can be wrong: check wiring before powering up.' : 'Answers come from the project\'s built-in knowledge.'}</p>
        </section>
      )}
    </>
  )
}
