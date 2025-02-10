// Map to store sub-agent states
export interface SubAgentState {
  prompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  aborted: boolean;
}

export const subAgentStates = new Map<string, SubAgentState>();
