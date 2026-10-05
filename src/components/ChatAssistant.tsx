import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Check, Copy, MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import { answerLocally, BOT_NAME, GREETING } from '../assistant/knowledge'
import './ChatAssistant.css'

type ChatMessage = { role: 'user' | 'assistant'; text: string }

type ChatAssistantProps = {
  pageLabel: string
}

const FAILURE_MARKER = '\u0000'
const WELCOME: ChatMessage = { role: 'assistant', text: GREETING }

// Offline replies, adjusted so a second "hi" doesn't repeat the full introduction already on screen.
function offlineReply(question: string): string {
  const reply = answerLocally(question).text
  return reply === GREETING ? 'Hey! What are you building today? Tell me the parts you have, or paste the sketch you\'re stuck on.' : reply
}

function buildContext(pageLabel: string): string {
  return `The chat window already greeted the user with your introduction, so don't introduce yourself again unless asked.\nCurrent page: ${pageLabel}`
}

// ---- lightweight, safe rendering of the reply format: paragraphs, **bold**, `code`, ```code blocks```,
// lists, ### headings and markdown tables (React elements only, never raw HTML)

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="chat-code">
      <div className="chat-code-bar">
        <span>{language || 'code'}</span>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) }}>
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const segments = text.split(/```([a-zA-Z+#]*)\n?/)
  // Each fence adds a capture, so split() yields [text, openLang, code, closeLang, text, openLang, code, …].
  for (let index = 0; index < segments.length; index += 4) {
    renderText(segments[index], `t${index}`, blocks)
    // An unclosed fence (still streaming) also renders as a code block.
    if (segments[index + 2] !== undefined) {
      blocks.push(<CodeBlock key={`c${index}`} language={segments[index + 1] ?? ''} code={segments[index + 2].replace(/\n$/, '')} />)
    }
  }
  return <>{blocks}</>
}

function renderText(chunk: string, keyPrefix: string, blocks: ReactNode[]) {
  const lines = chunk.split('\n')
  let list: { ordered: boolean; items: string[] } | null = null
  const flushList = (key: string) => {
    if (!list) return
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>)
    blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>)
    list = null
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const key = `${keyPrefix}-${index}`
    // Markdown table: a header row followed by a |---|---| separator.
    if (line.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1] ?? '')) {
      flushList(`l-${key}`)
      const header = splitRow(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|')) rows.push(splitRow(lines[index++]))
      index--
      blocks.push(
        <div className="chat-table" key={`tb-${key}`}>
          <table>
            <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const heading = line.match(/^\s*#{1,4}\s+(.*)$/)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flushList(`l-${key}`)
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flushList(`l-${key}`)
    if (heading) blocks.push(<h4 key={key}>{inline(heading[1])}</h4>)
    else if (line.trim()) blocks.push(<p key={key}>{inline(line)}</p>)
  }
  flushList(`l-end-${keyPrefix}`)
}

export function ChatAssistant({ pageLabel }: ChatAssistantProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Ask the server once whether the AI backend is configured.
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

  function replaceLastAssistant(text: string) {
    setMessages((current) => [...current.slice(0, -1), { role: 'assistant', text }])
  }

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    // The opening greeting is shown to the user but isn't part of the conversation sent to the model.
    const history = [...messages, { role: 'user' as const, text }]
    setMessages([...history, { role: 'assistant', text: '' }])
    setInput('')
    setBusy(true)

    try {
      if (aiAvailable !== true) {
        // Small pause so the reply doesn't appear before the typing indicator registers.
        await new Promise((resolve) => window.setTimeout(resolve, 450))
        replaceLastAssistant(offlineReply(text))
        return
      }
      const conversation = history.filter((message, index) => !(index === 0 && message === WELCOME))
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversation.slice(-12).map((message) => ({ role: message.role, content: message.text })),
          context: buildContext(pageLabel),
        }),
      })
      if (!response.ok || response.headers.get('X-Assistant-Mode') !== 'ai' || !response.body) {
        if (response.status === 503) setAiAvailable(false)
        replaceLastAssistant(response.status === 429 ? 'You\'re sending messages a bit fast. Give me a few seconds and ask again.' : offlineReply(text))
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
        replaceLastAssistant(received)
      }
      if (!received.trim() || received.startsWith(FAILURE_MARKER)) replaceLastAssistant(offlineReply(text))
    } catch {
      replaceLastAssistant(offlineReply(text))
    } finally {
      setBusy(false)
    }
  }

  const status = aiAvailable === null ? 'Connecting…' : aiAvailable ? 'Online' : 'Limited mode'

  return (
    <>
      {!open && (
        <button type="button" className="chat-launcher" onClick={() => setOpen(true)} aria-label={`Chat with ${BOT_NAME}`}>
          <MessageCircle size={20} /><span>Chat with {BOT_NAME}</span>
        </button>
      )}
      {open && (
        <section className="chat-panel" role="dialog" aria-label={`${BOT_NAME} chat`}>
          <header className="chat-header">
            <span className="chat-avatar"><Bot size={17} /><i className={aiAvailable ? 'is-online' : ''} /></span>
            <div>
              <strong>{BOT_NAME}</strong>
              <small className={aiAvailable ? 'is-online' : ''}>{status}</small>
            </div>
            {messages.length > 1 && <button type="button" className="chat-icon-button" onClick={() => setMessages([WELCOME])} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>}
            <button type="button" className="chat-icon-button" onClick={() => setOpen(false)} aria-label="Close chat" title="Close"><X size={17} /></button>
          </header>

          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.map((message, index) => (
              <div key={index} className={`chat-message is-${message.role}`}>
                {message.role === 'assistant' && message.text === '' ? <span className="chat-typing" aria-label={`${BOT_NAME} is typing`}><i /><i /><i /></span> : message.role === 'user' ? <p>{message.text}</p> : <RichText text={message.text} />}
              </div>
            ))}
          </div>

          <form className="chat-input" onSubmit={(event) => { event.preventDefault(); void ask(input) }}>
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              maxLength={4000}
              placeholder={`Message ${BOT_NAME}…`}
              aria-label="Your message"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(input) }
              }}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
          </form>
        </section>
      )}
    </>
  )
}
