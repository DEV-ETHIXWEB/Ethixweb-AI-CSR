import {
  ToolHandlerError,
  type ToolHandler,
  type ToolHandlerContext,
} from "../../domain/tool-definition";

export class FakeToolHandler implements ToolHandler {
  public callCount = 0;
  public readonly receivedInputs: unknown[] = [];
  public behavior: "succeed" | "throw-retryable" | "throw-non-retryable" | "hang" = "succeed";
  public output: unknown = { ok: true };

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    this.callCount += 1;
    this.receivedInputs.push(input);
    if (this.behavior === "hang") {
      return new Promise(() => undefined);
    }
    if (this.behavior === "throw-retryable") {
      throw new ToolHandlerError("transient failure", true);
    }
    if (this.behavior === "throw-non-retryable") {
      throw new ToolHandlerError("permanent failure", false);
    }
    return this.output;
  }
}
