import Anthropic from "@anthropic-ai/sdk";
import { Tool } from "../../core/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { subAgentStates } from "./subAgentState.js";

const parameterSchema = z.object({
  instanceId: z
    .string()
    .describe("The instance ID of the sub-agent to interact with"),
  message: z
    .string()
    .optional()
    .describe("The message to send to the sub-agent (required unless aborting)"),
  description: z
    .string()
    .max(80)
    .describe("Brief description of the interaction purpose (max 80 chars)"),
  abort: z
    .boolean()
    .optional()
    .describe("Whether to abort the sub-agent instead of sending a message"),
});

const returnSchema = z
  .object({
    response: z.string().describe("Response from the sub-agent or abort confirmation"),
  })
  .describe("Result containing the sub-agent's response or abort status");

type Parameters = z.infer<typeof parameterSchema>;
type ReturnType = z.infer<typeof returnSchema>;

export const subAgentMessageTool: Tool<Parameters, ReturnType> = {
  name: "subAgentMessage",
  description: "Sends a message to or aborts an existing sub-agent",
  parameters: zodToJsonSchema(parameterSchema),
  returns: zodToJsonSchema(returnSchema),

  execute: async (
    params,
    { logger },
  ): Promise<ReturnType> => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }

    const state = subAgentStates.get(params.instanceId);
    if (!state) {
      throw new Error("Sub-agent not found");
    }

    if (state.aborted) {
      throw new Error("Sub-agent has been aborted");
    }

    if (params.abort) {
      logger.verbose(`Aborting sub-agent ${params.instanceId}`);
      state.aborted = true;
      return {
        response: "Sub-agent aborted",
      };
    }

    if (!params.message) {
      throw new Error("Message is required when not aborting");
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Create messages array with conversation history
    const messages = [
      {
        role: "user" as const,
        content: state.prompt,
      },
      ...state.messages,
      {
        role: "user" as const,
        content: params.message,
      },
    ];

    // Get response
    logger.verbose(`Sending message to Anthropic API`);
    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 4096,
      messages,
    });

    // Check if response content exists and has the expected structure
    if (!response.content?.[0]?.text) {
      throw new Error("Invalid response from Anthropic API");
    }

    const responseText = response.content[0].text;
    logger.verbose(`Received response from sub-agent`);

    // Store the interaction
    state.messages.push(
      { role: "user", content: params.message },
      { role: "assistant", content: responseText }
    );

    return {
      response: responseText,
    };
  },

  logParameters: (input, { logger }) => {
    if (input.abort) {
      logger.info(`Aborting sub-agent ${input.instanceId}: ${input.description}`);
    } else {
      logger.info(`Sending message to sub-agent ${input.instanceId}: ${input.description}`);
      logger.verbose(`Message: ${input.message}`);
    }
  },

  logReturns: (result, { logger }) => {
    logger.verbose(`Received ${result.response.length} characters in response`);
  },
};
