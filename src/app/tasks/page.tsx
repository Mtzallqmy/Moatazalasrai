"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/db/schema";
import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل تحميل المهام.");
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل تحميل المهام.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Standard "fetch on mount" pattern (matches React's own data-fetching
    // docs: https://react.dev/learn/synchronizing-with-effects). `load`
    // itself updates state after the fetch resolves; deliberately allowed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold">المهام</h1>
        <p className="text-sm text-slate-500">
          مخزّنة في Neon Postgres عبر Drizzle — مثال حقيقي يُثبت أن السلسلة الكاملة تعمل.
        </p>
      </div>

      <TaskForm onCreated={load} />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error} — تأكد من ضبط DATABASE_URL (راجع .env.example).
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">جارٍ التحميل...</p>
      ) : (
        <TaskList tasks={tasks} onChanged={load} />
      )}
    </main>
  );
}
