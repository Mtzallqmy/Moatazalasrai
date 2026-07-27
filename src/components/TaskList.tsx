"use client";

import { useTransition } from "react";
import type { Task } from "@/db/schema";
import { formatDate } from "@/lib/utils";

export function TaskList({
  tasks,
  onChanged,
}: {
  tasks: Task[];
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function toggle(task: Task) {
    startTransition(async () => {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !task.done }),
      });
      onChanged();
    });
  }

  function remove(task: Task) {
    startTransition(async () => {
      await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      onChanged();
    });
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-slate-400">لا توجد مهام بعد. أضف أول مهمة أعلاه.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => toggle(task)}
              disabled={isPending}
              className="h-4 w-4 accent-brand-600"
            />
            <div>
              <p className={task.done ? "text-slate-400 line-through" : "text-slate-900"}>
                {task.title}
              </p>
              <p className="text-xs text-slate-400">{formatDate(task.createdAt)}</p>
            </div>
          </div>
          <button
            onClick={() => remove(task)}
            disabled={isPending}
            className="text-xs font-medium text-red-500 hover:text-red-700"
          >
            حذف
          </button>
        </li>
      ))}
    </ul>
  );
}
