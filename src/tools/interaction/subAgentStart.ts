import Anthropic from "@anthropic-ai/sdk";
import { Tool } from "../../core/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { subAgentStates } from "./subAgentState.js";
import { v4 as uuidv4 } from "uuid";

const parameterSchema = z.object({
  prompt: z
    .string()
    .describe("The prompt/task for the sub-agent"),
  description: z
    .string()
    .max(80)
    .describe("A brief description of the sub-agent's purpose (max 80 chars)"),
});

const returnSchema = z
  .object({
    instanceId: z.string().describe("Unique identifier for the sub-agent instance"),
    response: z.string().describe("Initial response from the sub-agent"),
  })
  .describe("Result containing sub-agent instance ID and initial response");

type Parameters = z.infer<typeof parameterSchema>;
type ReturnType = z.infer<typeof returnSchema>;

export const subAgentStartTool: Tool<Parameters, ReturnType> = {
  name: "subAgentStart",
  description: "Creates a sub-agent that has access to all tools to solve a specific task",
  parameters: zodToJsonSchema(parameterSchema),
  returns: zodToJsonSchema(returnSchema),

  execute: async (
    params,
    { logger },
  ): Promise<ReturnType> => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Create new instance ID
    const instanceId = uuidv4();
    logger.verbose(`Creating new sub-agent with instance ID: ${instanceId}`);

    // Initialize sub-agent state
    subAgentStates.set(instanceId, {
      prompt: params.prompt,
      messages: [],
      aborted: false,
    });

    // Get initial response
    logger.verbose(`Getting initial response from Anthropic API`);
    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: params.prompt,
        },
      ],
    });

    // Check if response content exists and has the expected structure
    if (!response.content?.[0]?.text) {
      throw new Error("Invalid response from Anthropic API");
    }

    const responseText = response.content[0].text;
    logger.verbose(`Received response from sub-agent`);

    // Store the interaction
    const state = subAgentStates.get(instanceId)!;
    state.messages.push(
      { role: "user", content: params.prompt },
      { role: "assistant", content: responseText },
    );

    return {
      instanceId,
      response: responseText,
    };
  },

  logParameters: (input, { logger }) => {
    logger.info(`Starting sub-agent: ${input.description}`);
    logger.verbose(`Prompt: ${input.prompt}`);
  },

  logReturns: (result, { logger }) => {
    logger.verbose(`Sub-agent ${result.instanceId} started successfully`);
  },
};
