import { toolAgent } from "../../core/toolAgent.js";
import { Tool } from "../../core/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getTools } from "../getTools.js";

const parameterSchema = z.object({
  prompt: z.string().describe("The prompt/task for the sub-agent"),
  description: z
    .string()
    .max(80)
    .describe("A brief description of the sub-agent's purpose (max 80 chars)"),
});

const returnSchema = z
  .string()
  .describe(
    "The response from the sub-agent including its reasoning and tool usage",
  );

type Parameters = z.infer<typeof parameterSchema>;
type ReturnType = z.infer<typeof returnSchema>;

// Sub-agent specific configuration
const subAgentConfig = {
  maxIterations: 50,
  model: "claude-3-5-sonnet-20241022",
  maxTokens: 4096,
  temperature: 0.7,
  getSystemPrompt: async () => {
    return [
      "You are a focused AI sub-agent handling a specific task.",
      "You have access to the same tools as the main agent but should focus only on your assigned task.",
      "When complete, call the sequenceComplete tool with your results.",
      "Follow any specific conventions or requirements provided in the task context.",
      "Ask the main agent for clarification if critical information is missing.",
    ].join("\n");
  },
};

export const subAgentTool: Tool<Parameters, ReturnType> = {
  name: "subAgent",
  description:
    "Creates a sub-agent that has access to all tools to solve a specific task",
  parameters: zodToJsonSchema(parameterSchema),
  returns: zodToJsonSchema(returnSchema),
  execute: async (params, { logger }) => {
    // Validate parameters
    const { prompt } = parameterSchema.parse(params);

    const tools = (await getTools()).filter(
      (tool) => tool.name !== "userPrompt",
    );

    const state = toolAgent(prompt, tools, logger, subAgentConfig);
    const result = await state.done;
    if (!result.result) {
      throw new Error("Sub-agent completed without a result");
    }
    return result.result;
  },
  logParameters: (input, { logger }) => {
    logger.info(`Delegating task "${input.description}"`);
  },
  logReturns: () => {},
};
