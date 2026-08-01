export class ToolTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Tool call timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

/** docs/04 §2 stage 4 — "enforced by the broker, not by the tool implementation." */
export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
