"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Message } from "../types";

const VIRTUALIZE_AFTER = 100;
const OVERSCAN_PX = 900;

function estimatedHeight(message: Message) {
  const contentLines = Math.max(1, Math.ceil(message.content.length / 70));
  return Math.min(520, 88 + contentLines * 25 + (message.attachments?.length ?? 0) * 52);
}

export function useVirtualMessageWindow(messages: Message[], viewportRef: RefObject<HTMLDivElement | null>) {
  const [measured, setMeasured] = useState<Map<string, number>>(() => new Map());
  const observersRef = useRef(new Map<string, ResizeObserver>());
  const [range, setRange] = useState({ start: 0, end: messages.length });
  const virtualized = messages.length > VIRTUALIZE_AFTER;

  const layout = useMemo(() => {
    const offsets = new Array<number>(messages.length + 1);
    offsets[0] = 0;
    for (let index = 0; index < messages.length; index += 1) {
      offsets[index + 1] = offsets[index] + (measured.get(messages[index].id) ?? estimatedHeight(messages[index]));
    }
    return offsets;
  }, [measured, messages]);

  const updateRange = useCallback(() => {
    if (!virtualized) {
      setRange({ start: 0, end: messages.length });
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = Math.max(0, viewport.scrollTop - OVERSCAN_PX);
    const bottom = viewport.scrollTop + viewport.clientHeight + OVERSCAN_PX;
    let start = 0;
    let end = messages.length;
    while (start < messages.length && layout[start + 1] < top) start += 1;
    end = start;
    while (end < messages.length && layout[end] < bottom) end += 1;
    setRange((current) => current.start === start && current.end === end ? current : { start, end: Math.min(messages.length, end + 1) });
  }, [layout, messages.length, viewportRef, virtualized]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateRange();
    viewport.addEventListener("scroll", updateRange, { passive: true });
    const observer = new ResizeObserver(updateRange);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", updateRange);
      observer.disconnect();
    };
  }, [updateRange, viewportRef]);

  useEffect(() => {
    const known = new Set(messages.map((message) => message.id));
    for (const [id, observer] of observersRef.current) {
      if (!known.has(id)) {
        observer.disconnect();
        observersRef.current.delete(id);
        setMeasured((current) => {
          if (!current.has(id)) return current;
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    }
  }, [messages]);

  useEffect(() => () => {
    for (const observer of observersRef.current.values()) observer.disconnect();
    observersRef.current.clear();
  }, []);

  const register = useCallback((id: string, node: HTMLElement | null) => {
    observersRef.current.get(id)?.disconnect();
    observersRef.current.delete(id);
    if (!node || !virtualized) return;
    const record = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height > 0) setMeasured((current) => {
        if (current.get(id) === height) return current;
        const next = new Map(current);
        next.set(id, height);
        return next;
      });
    };
    record();
    const observer = new ResizeObserver(record);
    observer.observe(node);
    observersRef.current.set(id, observer);
  }, [virtualized]);

  const start = virtualized ? Math.min(range.start, messages.length) : 0;
  const end = virtualized ? Math.max(start, Math.min(range.end, messages.length)) : messages.length;
  return {
    visibleMessages: messages.slice(start, end),
    topSpacer: layout[start] ?? 0,
    bottomSpacer: Math.max(0, (layout[messages.length] ?? 0) - (layout[end] ?? 0)),
    register,
    virtualized,
    renderedCount: end - start,
  };
}
