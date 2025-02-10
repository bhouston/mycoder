import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subAgentStartTool } from "./subAgentStart.js";
import { subAgentMessageTool } from "./subAgentMessage.js";
import { Logger } from "../../utils/logger.js";
import { subAgentStates } from "./subAgentState.js";

const logger = new Logger({ name: "subAgentStart", logLevel: "warn" });

// Mock Anthropic client response
const mockResponse = {
  content: [
    {
      type: "text",
      text: "Initial response from sub-agent",
    },
  ],
  usage: { input_tokens: 10, output_tokens: 10 },
};

// Mock message response
const mockMessageResponse = {
  content: [
    {
      type: "text",
      text: "Response to message",
    },
  ],
  usage: { input_tokens: 5, output_tokens: 5 },
};

// Mock message creation function
const mockCreateMessage = vi.fn();

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: mockCreateMessage,
    };
  },
}));

describe("subAgentStart and subAgentMessage", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    subAgentStates.clear();
    vi.clearAllMocks();
    // Reset mock implementation for each test
    mockCreateMessage.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    subAgentStates.clear();
  });

  describe("subAgentStart", () => {
    it("should start a sub-agent and return an instance ID", async () => {
      mockCreateMessage.mockResolvedValueOnce(mockResponse);
      const result = await subAgentStartTool.execute(
        {
          prompt: "Test sub-agent task",
          description: "A test agent for unit testing",
        },
        { logger },
      );

      expect(result.instanceId).toBeDefined();
      expect(result.response).toContain("Initial response from sub-agent");
      expect(subAgentStates.has(result.instanceId)).toBe(true);
    });

    it("should handle multiple concurrent sub-agents", async () => {
      mockCreateMessage.mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce(mockResponse);
      const result1 = await subAgentStartTool.execute(
        {
          prompt: "First agent task",
          description: "First test agent",
        },
        { logger },
      );

      const result2 = await subAgentStartTool.execute(
        {
          prompt: "Second agent task",
          description: "Second test agent",
        },
        { logger },
      );

      expect(result1.instanceId).not.toBe(result2.instanceId);
      expect(subAgentStates.has(result1.instanceId)).toBe(true);
      expect(subAgentStates.has(result2.instanceId)).toBe(true);
    });

    it("should validate description length", async () => {
      const longDescription =
        "This is a very long description that exceeds the maximum allowed length of 80 characters and should fail";

      await expect(
        subAgentStartTool.execute(
          {
            prompt: "Test task",
            description: longDescription,
          },
          { logger },
        ),
      ).rejects.toThrow();
    });

    it("should handle API errors gracefully", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(
        subAgentStartTool.execute(
          {
            prompt: "Test task",
            description: "Should fail",
          },
          { logger },
        ),
      ).rejects.toThrow("ANTHROPIC_API_KEY environment variable is not set");
    });
  });

  describe("subAgentMessage", () => {
    let instanceId: string;

    beforeEach(async () => {
      mockCreateMessage.mockResolvedValueOnce(mockResponse);
      const result = await subAgentStartTool.execute(
        {
          prompt: "Test sub-agent task",
          description: "Test agent for messaging",
        },
        { logger },
      );
      instanceId = result.instanceId;
    });

    it("should send a message to an existing sub-agent", async () => {
      mockCreateMessage.mockResolvedValueOnce(mockMessageResponse);
      const result = await subAgentMessageTool.execute(
        {
          instanceId,
          message: "Test message",
          description: "Test message interaction",
        },
        { logger },
      );

      expect(result.response).toContain("Response to message");
    });

    it("should handle invalid instance IDs", async () => {
      await expect(
        subAgentMessageTool.execute(
          {
            instanceId: "invalid-id",
            message: "Test message",
            description: "Should fail",
          },
          { logger },
        ),
      ).rejects.toThrow("Sub-agent not found");
    });

    it("should handle messaging aborted agents", async () => {
      // Abort the agent
      await subAgentMessageTool.execute(
        {
          instanceId,
          description: "Aborting agent",
          abort: true,
        },
        { logger },
      );

      // Try to send a message after abort
      await expect(
        subAgentMessageTool.execute(
          {
            instanceId,
            message: "Test message",
            description: "Should fail - agent aborted",
          },
          { logger },
        ),
      ).rejects.toThrow("Sub-agent has been aborted");
    });

    it("should abort a sub-agent", async () => {
      const result = await subAgentMessageTool.execute(
        {
          instanceId,
          description: "Aborting agent",
          abort: true,
        },
        { logger },
      );

      expect(result.response).toContain("Sub-agent aborted");
      expect(subAgentStates.get(instanceId)?.aborted).toBe(true);
    });

    it("should validate message description length", async () => {
      const longDescription =
        "This is a very long description that exceeds the maximum allowed length of 80 characters and should fail";

      await expect(
        subAgentMessageTool.execute(
          {
            instanceId,
            message: "Test message",
            description: longDescription,
          },
          { logger },
        ),
      ).rejects.toThrow();
    });
  });
});
