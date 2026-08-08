"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export function useAutoScroll(viewportRef: RefObject<HTMLDivElement | null>, contentSignal: string) {
  const nearBottomRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 160;
    nearBottomRef.current = nearBottom;
    setShowLatest(!nearBottom);
  }, [viewportRef]);

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (nearBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
        setShowLatest(false);
      } else {
        setShowLatest(true);
      }
    });
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [contentSignal, viewportRef]);

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    nearBottomRef.current = true;
    setShowLatest(false);
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [viewportRef]);

  const pinToBottom = useCallback(() => {
    nearBottomRef.current = true;
  }, []);

  return { showLatest, onScroll, scrollToLatest, pinToBottom, nearBottomRef };
}
