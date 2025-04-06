import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCommandTools } from "./load-commands.js";
import { logger } from "./utils/logger.js";

// Initialize FastMCP server
const mcp = new McpServer({ name: "shelly-forge" });

// --- Server Initialization and Run ---

async function main() {
    logger.log("Starting Shelly Forge MCP Server...");

    // Load command tools
    try {
        const commandTools = await loadCommandTools();
        for (const tool of commandTools) {
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
                tool.inputSchema.shape,
                adaptedCallback
            );
        }
    } catch (error) {
        logger.error("Failed to load command tools", error);
    }

    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    logger.log("Shelly Forge MCP Server running and connected.");
}

main().catch((error) => {
    logger.error("Failed to start MCP server", error);
    process.exit(1);
});
