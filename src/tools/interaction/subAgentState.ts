import { ToolAgentState } from "../../core/toolAgent.js";

// Map to store sub-agent states
export interface SubAgentState {
  prompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  aborted: boolean;
  toolAgentState: ToolAgentState;
}

export const subAgentStates = new Map<string, SubAgentState>();
