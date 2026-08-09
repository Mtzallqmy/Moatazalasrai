"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Message } from "../types";

const VIRTUALIZE_AFTER = 60;
const OVERSCAN_PX = 900;

function firstOffsetAfter(offsets: number[], target: number) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function estimatedHeight(message: Message) {
  const contentLines = Math.max(1, Math.ceil(message.content.length / 70));
  return Math.min(520, 88 + contentLines * 25 + (message.attachments?.length ?? 0) * 52);
}

export function useVirtualMessageWindow(messages: Message[], viewportRef: RefObject<HTMLDivElement | null>) {
  const [measured, setMeasured] = useState<Map<string, number>>(() => new Map());
  const observersRef = useRef(new Map<string, ResizeObserver>());
  const rangeFrameRef = useRef<number | null>(null);
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
    const start = Math.max(0, Math.min(messages.length, firstOffsetAfter(layout, top) - 1));
    const end = Math.max(start, Math.min(messages.length, firstOffsetAfter(layout, bottom)));
    setRange((current) => current.start === start && current.end === end ? current : { start, end: Math.min(messages.length, end + 1) });
  }, [layout, messages.length, viewportRef, virtualized]);

  const scheduleRangeUpdate = useCallback(() => {
    if (rangeFrameRef.current !== null) return;
    rangeFrameRef.current = requestAnimationFrame(() => {
      rangeFrameRef.current = null;
      updateRange();
    });
  }, [updateRange]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateRange();
    viewport.addEventListener("scroll", scheduleRangeUpdate, { passive: true });
    const observer = new ResizeObserver(scheduleRangeUpdate);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", scheduleRangeUpdate);
      observer.disconnect();
      if (rangeFrameRef.current !== null) cancelAnimationFrame(rangeFrameRef.current);
      rangeFrameRef.current = null;
    };
  }, [scheduleRangeUpdate, updateRange, viewportRef]);

  useEffect(() => {
    const known = new Set(messages.map((message) => message.id));
    const removed: string[] = [];
    for (const [id, observer] of observersRef.current) {
      if (!known.has(id)) {
        observer.disconnect();
        observersRef.current.delete(id);
        removed.push(id);
      }
    }
    if (!removed.length) return;
    const cleanupFrame = requestAnimationFrame(() => setMeasured((current) => {
        const next = new Map(current);
        let changed = false;
        for (const id of removed) changed = next.delete(id) || changed;
        return changed ? next : current;
      }));
    return () => cancelAnimationFrame(cleanupFrame);
  }, [messages]);

  useEffect(() => () => {
    if (rangeFrameRef.current !== null) cancelAnimationFrame(rangeFrameRef.current);
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
