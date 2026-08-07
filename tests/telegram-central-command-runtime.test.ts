import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  process: vi.fn(async () => undefined),
}));

vi.mock("@/lib/telegram/update-processor", () => ({
  processTelegramUpdate: mocks.process,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("central Telegram queued command runtime", () => {
  it("forwards /start to the real update processor", async () => {
    const { telegramUpdateProcessTask } = await import("@/worker/tasks/telegram-update-process");
    const update = {
      update_id: 1001,
      message: { message_id: 1, text: "/start", chat: { id: 10 }, from: { id: 20 } },
    };
    await telegramUpdateProcessTask({
      updateRowId: "00000000-0000-4000-8000-000000000001",
      updateId: 1001,
      update,
    }, {} as never);
    expect(mocks.process).toHaveBeenCalledWith({
      updateRowId: "00000000-0000-4000-8000-000000000001",
      update,
    });
  });

  it("forwards /start link_<code> without exposing the code in queue metadata", async () => {
    const { telegramUpdateProcessTask } = await import("@/worker/tasks/telegram-update-process");
    const update = {
      update_id: 1002,
      message: { message_id: 2, text: "/start link_123456", chat: { id: 10 }, from: { id: 20 } },
    };
    const payload = {
      updateRowId: "00000000-0000-4000-8000-000000000002",
      updateId: 1002,
      update,
    };
    await telegramUpdateProcessTask(payload, {} as never);
    expect(mocks.process).toHaveBeenCalledWith({ updateRowId: payload.updateRowId, update });
    expect(Object.keys(payload)).not.toContain("code");
  });

  it("forwards callback_query actions to the processor", async () => {
    const { telegramUpdateProcessTask } = await import("@/worker/tasks/telegram-update-process");
    const update = {
      update_id: 1003,
      callback_query: {
        id: "callback-1",
        data: "nav:home",
        from: { id: 20 },
        message: { message_id: 3, chat: { id: 10 } },
      },
    };
    await telegramUpdateProcessTask({
      updateRowId: "00000000-0000-4000-8000-000000000003",
      updateId: 1003,
      update,
    }, {} as never);
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ update }));
  });

  it("rejects malformed worker payloads before command execution", async () => {
    const { telegramUpdateProcessTask } = await import("@/worker/tasks/telegram-update-process");
    await expect(telegramUpdateProcessTask({ updateId: 1004 }, {} as never)).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
