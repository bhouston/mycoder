import Anthropic from "@anthropic-ai/sdk";
import { executeToolCall } from "./executeToolCall.js";
import { Logger } from "../utils/logger.js";
import {
  Tool,
  TextContent,
  ToolUseContent,
  ToolResultContent,
  Message,
} from "./types.js";
import { execSync } from "child_process";
import { Readable, Writable } from "stream";
import { getAnthropicApiKeyError } from "../utils/errors.js";

export interface ToolAgentResult {
  result: string;
  tokens: {
    input: number;
    output: number;
  };
  interactions: number;
}

export interface ToolAgentState {
  outMessages: Readable;
  inMessages: Writable;
  result?: string;
  error?: Error;
  input_tokens: number;
  output_tokens: number;
  done: Promise<ToolAgentResult>;
}

const CONFIG = {
  maxIterations: 50,
  model: "claude-3-5-sonnet-20241022",
  maxTokens: 4096,
  temperature: 0.7,
  getSystemPrompt: async () => {
    // Gather context with error handling
    const getCommandOutput = (command: string, label: string): string => {
      try {
        return execSync(command).toString().trim();
      } catch (error) {
        return `[Error getting ${label}: ${(error as Error).message}]`;
      }
    };

    const context = {
      pwd: getCommandOutput("pwd", "current directory"),
      files: getCommandOutput("ls -la", "file listing"),
      system: getCommandOutput("uname -a", "system information"),
      datetime: new Date().toString(),
    };

    return [
      "You are an AI agent that can use tools to accomplish tasks.",
      "",
      "Current Context:",
      `Directory: ${context.pwd}`,
      "Files:",
      context.files,
      `System: ${context.system}`,
      `DateTime: ${context.datetime}`,
      "",
      "You prefer to call tools in parallel when possible because it leads to faster execution and less resource usage.",
      "When done, call the sequenceComplete tool with your results to indicate that the sequence has completed.",
      "",
      "For coding tasks:",
      "0. Try to break large tasks into smaller sub-tasks that can be completed and verified sequentially.",
      "   - trying to make lots of changes in one go can make it really hard to identify when something doesn't work",
      "   - use sub-agents for each sub-task, leaving the main agent in a supervisory role",
      "   - when possible ensure the project compiles/builds and the tests pass after each sub-task",
      "   - give the sub-agents the guidance and context necessary be successful",
      "1. First understand the context by:",
      "   - Reading README.md, CONTRIBUTING.md, and similar documentation",
      "   - Checking project configuration files (e.g., package.json)",
      "   - Understanding coding standards",
      "2. Ensure changes:",
      "   - Follow project conventions",
      "   - Build successfully",
      "   - Pass all tests",
      "3. Update documentation as needed",
      "4. Consider adding documentation if you encountered setup/understanding challenges",
      "",
      "When you run into issues or unexpected results, take a step back and read the project documentation and configuration files and look at other source files in the project for examples of what works.",
      "",
      "Use sub-agents for parallel tasks, providing them with specific context they need rather than having them rediscover it.",
    ].join("\n");
  },
};

interface ToolCallResult {
  sequenceCompleted: boolean;
  completionResult?: string;
  toolResults: ToolResultContent[];
}

function processResponse(response: Anthropic.Message) {
  const content: (TextContent | ToolUseContent)[] = [];
  const toolCalls: ToolUseContent[] = [];

  for (const message of response.content) {
    if (message.type === "text") {
      content.push({ type: "text", text: message.text });
    } else if (message.type === "tool_use") {
      const toolUse: ToolUseContent = {
        type: "tool_use",
        name: message.name,
        id: message.id,
        input: message.input,
      };
      content.push(toolUse);
      toolCalls.push(toolUse);
    }
  }

  return { content, toolCalls };
}

async function executeTools(
  toolCalls: ToolUseContent[],
  tools: Tool[],
  messages: Message[],
  logger: Logger,
): Promise<ToolCallResult> {
  if (toolCalls.length === 0) {
    return { sequenceCompleted: false, toolResults: [] };
  }

  logger.verbose(`Executing ${toolCalls.length} tool calls`);

  const results = await Promise.all(
    toolCalls.map(async (call) => {
      let toolResult = "";
      try {
        toolResult = await executeToolCall(call, tools, logger);
      } catch (error: any) {
        toolResult = `Error: Exception thrown during tool execution.  Type: ${error.constructor.name}, Message: ${error.message}`;
      }
      return {
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: toolResult,
        isComplete: call.name === "sequenceComplete",
      };
    }),
  );

  const toolResults = results.map(({ type, tool_use_id, content }) => ({
    type,
    tool_use_id,
    content,
  }));

  const sequenceCompleted = results.some((r) => r.isComplete);
  const completionResult = results.find((r) => r.isComplete)?.content;

  messages.push({ role: "user", content: toolResults });

  if (sequenceCompleted) {
    logger.verbose("Sequence completed", { completionResult });
  }

  return { sequenceCompleted, completionResult, toolResults };
}

// The main toolAgent function that now returns a ToolAgentState
export const toolAgent = (
  initialPrompt: string,
  tools: Tool[],
  logger: Logger,
  config = CONFIG,
): ToolAgentState => {
  // Create streams
  const outMessages = new Readable({
    objectMode: true,
    read() {}, // No-op since we push data manually
  });

  const inMessages = new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
      // Handle incoming messages (for future interactive features)
      callback();
    },
  });

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let interactions = 0;
  let currentResult: string | undefined;
  let currentError: Error | undefined;

  // Stream the initial user message
  outMessages.push({ type: "user", content: initialPrompt });

  // Create a promise that will resolve when the agent is done
  const donePromise = new Promise<ToolAgentResult>(async (resolve, reject) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const error = new Error(getAnthropicApiKeyError());
        currentError = error;
        outMessages.push({ type: "error", content: error });
        outMessages.push(null);
        reject(error);
        return;
      }

      const client = new Anthropic({ apiKey });
      const messages: Message[] = [
        {
          role: "user",
          content: [{ type: "text", text: initialPrompt }],
        },
      ];

      logger.debug("User message:", initialPrompt);

      const systemPrompt = await config.getSystemPrompt();

      for (let i = 0; i < config.maxIterations; i++) {
        logger.verbose(
          `Requesting completion ${i + 1} with ${messages.length} messages`,
        );

        interactions++;
        const response = await client.messages.create({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          messages,
          system: systemPrompt,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool.InputSchema,
          })),
          tool_choice: { type: "auto" },
        });

        if (!response.content.length) {
          currentResult = "Agent returned empty message implying it is done its given task";
          const result = {
            result: currentResult,
            tokens: {
              input: totalInputTokens,
              output: totalOutputTokens,
            },
            interactions,
          };
          outMessages.push({ type: "complete", content: result });
          outMessages.push(null);
          resolve(result);
          return;
        }

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        const { content, toolCalls } = processResponse(response);
        messages.push({ role: "assistant", content });

        // Stream assistant's messages
        const assistantMessage = content
          .filter((c) => c.type === "text")
          .map((c) => (c as TextContent).text)
          .join("\n");
        if (assistantMessage) {
          logger.info(assistantMessage);
          outMessages.push({ type: "assistant", content: assistantMessage });
        }

        const { sequenceCompleted, completionResult } = await executeTools(
          toolCalls,
          tools,
          messages,
          logger,
        );

        if (sequenceCompleted) {
          currentResult = completionResult ?? "Sequence explicitly completed with an empty result";
          const result = {
            result: currentResult,
            tokens: {
              input: totalInputTokens,
              output: totalOutputTokens,
            },
            interactions,
          };
          outMessages.push({ type: "complete", content: result });
          outMessages.push(null);
          resolve(result);
          return;
        }
      }

      logger.warn("Maximum iterations reached");
      currentResult = "Maximum sub-agent iterations reached without successful completion";
      const result = {
        result: currentResult,
        tokens: {
          input: totalInputTokens,
          output: totalOutputTokens,
        },
        interactions,
      };
      outMessages.push({ type: "complete", content: result });
      outMessages.push(null);
      resolve(result);

    } catch (error) {
      currentError = error as Error;
      outMessages.push({ type: "error", content: currentError });
      outMessages.push(null);
      reject(currentError);
    }
  });

  return {
    outMessages,
    inMessages,
    get result() { return currentResult; },
    get error() { return currentError; },
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    done: donePromise,
  };
};
