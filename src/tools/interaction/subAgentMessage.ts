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
    .describe(
      "The message to send to the sub-agent (required unless aborting)"
    ),
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
    messages: z.array(z.string()).describe("Output from the sub-agent"),
  })
  .describe("Result containing the sub-agent's response or abort status");

type Parameters = z.infer<typeof parameterSchema>;
type ReturnType = z.infer<typeof returnSchema>;

export const subAgentStatusTool: Tool<Parameters, ReturnType> = {
  name: "subAgentMessage",
  description: "Sends a message to or aborts an existing sub-agent",
  parameters: zodToJsonSchema(parameterSchema),
  returns: zodToJsonSchema(returnSchema),

  execute: async (params, { logger }): Promise<ReturnType> => {
    const state = subAgentStates.get(params.instanceId);
    if (!state) {
      throw new Error(`Sub-agent not found with ID: ${params.instanceId}`);
    }

    if (state.aborted) {
      throw new Error(`Sub-agent ${params.instanceId} has been aborted`);
    }

    if (params.abort) {
      logger.verbose(`Aborting sub-agent ${params.instanceId}`);
      state.toolAgentState.inMessages.write({ abort: true });
      state.aborted = true;
    }

    if (params.message) {
      // Send message
      logger.verbose(`Sending message to tool agent`);
      state.toolAgentState.inMessages.write(params.message);

      // Store the interaction
      state.messages.push({ role: "user", content: params.message });
    }
  },

  logParameters: (input, { logger }) => {
    if (input.abort) {
      logger.info(
        `Aborting sub-agent ${input.instanceId}: ${input.description}`
      );
    } else {
      logger.info(
        `Sending message to sub-agent ${input.instanceId}: ${input.description}`
      );
      logger.verbose(`Message: ${input.message}`);
    }
  },

  logReturns: (result, { logger }) => {
    logger.verbose(`Received ${result.response.length} characters in response`);
  },
};
