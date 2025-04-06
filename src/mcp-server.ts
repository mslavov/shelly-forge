import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCommandTools } from "./load-commands.js";
import { logger } from "./utils/logger.js";
import { CURRENT_WORKING_DIRECTORY } from "./utils/cwd.js";

// Initialize FastMCP server
const mcp = new McpServer({
    name: "shelly-forge",
    version: "0.1.0"
}, {
    instructions: `This server is used to execute Shelly Forge commands. 
It is used to develop, test, and deploy scripts to Shelly smart home devices`
});

// --- Server Initialization and Run ---

export async function main() {
    try {
        logger.enableConsole(false); // Enable console output for debugging
        logger.debug(`Current working directory: ${CURRENT_WORKING_DIRECTORY}`);
        logger.debug(`Environment variables: ${JSON.stringify(process.env, null, 2)}`);
        logger.debug("Starting Shelly Forge MCP Server...");

        // Load command tools
        try {
            const commandTools = await loadCommandTools();
            logger.debug(`Loaded ${commandTools.length} command tools`);

            for (const tool of commandTools) {
                if (["mcp", "init"].includes(tool.name)) {
                    logger.debug(`Skipping tool: ${tool.name} to avoid circular reference`);
                    continue;
                }
                // Adapt the callback to return in MCP format
                const adaptedCallback = async (args: any) => {
                    try {
                        const result = await tool.callback(args);
                        return { content: [{ type: "text" as const, text: result || "Command executed successfully" }] };
                    } catch (error) {
                        logger.error(`Command execution error in ${tool.name}`, error);
                        return { content: [{ type: "text" as const, text: `Command failed: ${(error as Error).message}` }] };
                    }
                };

                mcp.tool(
                    tool.name,
                    tool.description,
                    tool.inputSchema,
                    adaptedCallback
                );
                logger.debug(`Registered tool: ${tool.name}`);
            }
        } catch (error) {
            logger.error("Failed to load command tools", error);
        }

        logger.debug("Connecting MCP Server transport...");
        try {
            const transport = new StdioServerTransport();
            await mcp.connect(transport);
            logger.debug("Shelly Forge MCP Server running and connected.");
        } catch (error) {
            logger.error("Failed to connect MCP transport", error);
            throw error; // Make sure error is propagated
        }
    } catch (error) {
        logger.error("Critical MCP server error", error);
        throw error; // Ensure errors are propagated up
    }
}