import { Tool } from "../../core/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { subAgentStates, SubAgentState } from "./subAgentState.js";
import { v4 as uuidv4 } from "uuid";
import { toolAgent } from "../../core/toolAgent.js";
import { getTools } from "../getTools.js";

const parameterSchema = z.object({
  prompt: z.string().describe("The prompt/task for the sub-agent"),
  description: z
    .string()
    .max(80)
    .describe("A brief description of the sub-agent's purpose (max 80 chars)"),
});

const returnSchema = z
  .object({
    instanceId: z
      .string()
      .describe("Unique identifier for the sub-agent instance"),
    response: z.string().describe("Initial response from the sub-agent"),
  })
  .describe("Result containing sub-agent instance ID and initial response");

type Parameters = z.infer<typeof parameterSchema>;
type ReturnType = z.infer<typeof returnSchema>;

export const subAgentStartTool: Tool<Parameters, ReturnType> = {
  name: "subAgentStart",
  description:
    "Creates a sub-agent that has access to all tools to solve a specific task",
  parameters: zodToJsonSchema(parameterSchema),
  returns: zodToJsonSchema(returnSchema),

  execute: async (params, { logger }): Promise<ReturnType> => {
    const instanceId = uuidv4();
    logger.verbose(`Creating new sub-agent with instance ID: ${instanceId}`);

    try {
      const tools = (await getTools()).filter(
        (tool) => tool.name !== "userPrompt"
      );

      // Initialize toolAgent
      const toolAgentState = toolAgent(params.prompt, tools, logger);

      // Initialize sub-agent state
      const state: SubAgentState = {
        prompt: params.prompt,
        messages: [],
        aborted: false,
        toolAgentState,
      };
      subAgentStates.set(instanceId, state);

      // Set up message handling
      return new Promise((resolve, reject) => {
        let messageReceived = false;

        const messageHandler = (message: any) => {
          if (message.type === "assistant" && !messageReceived) {
            messageReceived = true;
            const initialResponse = message.content;

            // Store the interaction
            state.messages.push(
              { role: "user", content: params.prompt },
              { role: "assistant", content: initialResponse }
            );

            resolve({
              instanceId,
              response: initialResponse,
            });
          }
        };

        const errorHandler = (error: Error) => {
          state.aborted = true;
          reject(error);
        };

        const endHandler = () => {
          if (!messageReceived) {
            state.aborted = true;
            reject(
              new Error("Stream ended without receiving assistant message")
            );
          }
        };

        toolAgentState.outMessages
          .on("data", messageHandler)
          .on("error", errorHandler)
          .on("end", endHandler);
      });
    } catch (error) {
      logger.error(`Failed to start sub-agent: ${error}`);
      throw error;
    }
  },

  logParameters: (input, { logger }) => {
    logger.info(`Starting sub-agent: ${input.description}`);
    logger.verbose(`Prompt: ${input.prompt}`);
  },

  logReturns: (result, { logger }) => {
    logger.verbose(`Sub-agent ${result.instanceId} started successfully`);
  },
};
