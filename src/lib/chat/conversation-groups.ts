export type ConversationGroupKey = "pinned" | "today" | "yesterday" | "last7" | "last30" | "older";

export type ConversationGroup<T> = {
  key: ConversationGroupKey;
  label: string;
  items: T[];
};

const labels: Record<ConversationGroupKey, string> = {
  pinned: "المثبتة",
  today: "اليوم",
  yesterday: "أمس",
  last7: "آخر 7 أيام",
  last30: "آخر 30 يومًا",
  older: "الأقدم",
};

function timestamp(value: string | Date | null | undefined) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function groupConversations<T extends {
  id: string;
  updatedAt: string | Date;
  lastMessageAt?: string | Date | null;
  pinnedAt?: string | Date | null;
}>(items: T[], now = new Date()): ConversationGroup<T>[] {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const groups = new Map<ConversationGroupKey, T[]>([
    ["pinned", []], ["today", []], ["yesterday", []], ["last7", []], ["last30", []], ["older", []],
  ]);
  const sorted = [...items].sort((left, right) => {
    const pinDelta = timestamp(right.pinnedAt) - timestamp(left.pinnedAt);
    if (pinDelta) return pinDelta;
    const timeDelta = timestamp(right.lastMessageAt ?? right.updatedAt) - timestamp(left.lastMessageAt ?? left.updatedAt);
    return timeDelta || left.id.localeCompare(right.id);
  });

  for (const item of sorted) {
    if (item.pinnedAt) {
      groups.get("pinned")!.push(item);
      continue;
    }
    const time = timestamp(item.lastMessageAt ?? item.updatedAt);
    const age = Math.max(0, dayStart - time);
    const key: ConversationGroupKey = time >= dayStart
      ? "today"
      : age < 2 * day
        ? "yesterday"
        : age < 7 * day
          ? "last7"
          : age < 30 * day
            ? "last30"
            : "older";
    groups.get(key)!.push(item);
  }

  return (["pinned", "today", "yesterday", "last7", "last30", "older"] as const)
    .map((key) => ({ key, label: labels[key], items: groups.get(key)! }))
    .filter((group) => group.items.length > 0);
}
