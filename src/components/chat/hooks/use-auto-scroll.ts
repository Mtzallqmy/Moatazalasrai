"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const NEAR_BOTTOM_PX = 160;

export function useAutoScroll(viewportRef: RefObject<HTMLDivElement | null>, contentSignal: string) {
  const nearBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const contentFrameRef = useRef<number | null>(null);
  const showLatestRef = useRef(false);
  const [showLatest, setShowLatest] = useState(false);

  const updateLatest = useCallback((next: boolean) => {
    if (showLatestRef.current === next) return;
    showLatestRef.current = next;
    setShowLatest(next);
  }, []);

  const onScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < NEAR_BOTTOM_PX;
      nearBottomRef.current = nearBottom;
      updateLatest(!nearBottom);
    });
  }, [updateLatest, viewportRef]);

  useEffect(() => {
    if (contentFrameRef.current !== null) cancelAnimationFrame(contentFrameRef.current);
    contentFrameRef.current = requestAnimationFrame(() => {
      contentFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (nearBottomRef.current) {
        const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        if (Math.abs(viewport.scrollTop - target) > 1) viewport.scrollTop = target;
        updateLatest(false);
      } else {
        updateLatest(true);
      }
    });
    return () => {
      if (contentFrameRef.current !== null) cancelAnimationFrame(contentFrameRef.current);
      contentFrameRef.current = null;
    };
  }, [contentSignal, updateLatest, viewportRef]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (contentFrameRef.current !== null) cancelAnimationFrame(contentFrameRef.current);
  }, []);

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    nearBottomRef.current = true;
    updateLatest(false);
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
  }, [updateLatest, viewportRef]);

  const pinToBottom = useCallback(() => {
    nearBottomRef.current = true;
  }, []);

  return { showLatest, onScroll, scrollToLatest, pinToBottom, nearBottomRef };
}
