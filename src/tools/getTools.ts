import { readFileTool } from "../tools/io/readFile.js";
import { userPromptTool } from "../tools/interaction/userPrompt.js";
import { sequenceCompleteTool } from "../tools/system/sequenceComplete.js";
import { fetchTool } from "../tools/io/fetch.js";
import { Tool } from "../core/types.js";
import { updateFileTool } from "./io/updateFile.js";
import { shellStartTool } from "./system/shellStart.js";
import { shellMessageTool } from "./system/shellMessage.js";
import { subAgentStartTool } from "./interaction/subAgentStart.js";
import { subAgentMessageTool } from "./interaction/subAgentMessage.js";

export async function getTools(): Promise<Tool[]> {
  return [
    //subAgentTool, - remove for now.
    subAgentStartTool,
    subAgentMessageTool,
    readFileTool,
    updateFileTool,
    //shellExecuteTool, - remove for now.
    userPromptTool,
    sequenceCompleteTool,
    fetchTool,
    shellStartTool,
    shellMessageTool,
  ] as Tool[];
}
