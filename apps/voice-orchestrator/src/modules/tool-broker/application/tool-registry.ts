import { Injectable } from "@nestjs/common";
import type { ToolDefinition, ToolHandler } from "../domain/tool-definition";

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/** docs/13-implementation-backlog.md `tool-broker` module §1: "Tool registry: schema (Zod) + handler binding for each tool." */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((entry) => entry.definition);
  }
}
