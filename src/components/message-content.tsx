"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseInlineParts, parseMessageBlocks } from "@/lib/chat/message-format";

function InlineContent({ content }: { content: string }) {
  return <>{parseInlineParts(content).map((part, index) => {
    if (part.type === "code") return <code key={index} className="message-inline-code" dir="ltr">{part.content}</code>;
    if (part.type === "link") return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="message-safe-link">{part.content}</a>;
    return <span key={index}>{part.content}</span>;
  })}</>;
}

function CodeBlock({ language, content }: { language: string | null; content: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);
  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 1_500);
  }
  return <section className="message-code-block" dir="ltr">
    <header><span>{language || "text"}</span><button type="button" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "تم النسخ" : "نسخ"}</button></header>
    <pre tabIndex={0}><code>{content}</code></pre>
  </section>;
}

export function MessageContent({ content, pending = false }: { content: string; pending?: boolean }) {
  if (!content && pending) return <span className="message-streaming-placeholder" aria-label="جارٍ توليد الرد">…</span>;
  if (pending) return <div className="message-content message-content-streaming">{content}</div>;
  const blocks = parseMessageBlocks(content);
  return <div className="message-content">
    {blocks.map((block, index) => {
      if (block.type === "code") return <CodeBlock key={index} language={block.language} content={block.content} />;
      if (block.type === "list") {
        const Tag = block.ordered ? "ol" : "ul";
        return <Tag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent content={item} /></li>)}</Tag>;
      }
      return <p key={index}><InlineContent content={block.content} /></p>;
    })}
  </div>;
}
