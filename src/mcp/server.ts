import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs/promises";
import path from "path";
import url from "url"; // Needed for dynamic imports

// Initialize FastMCP server
const mcp = new McpServer({ name: "shelly-forge" });

// --- Dynamic Tool Loading ---

async function loadTools(server: McpServer) {
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const toolsDir = path.join(__dirname, "tools");
    try {
        const files = await fs.readdir(toolsDir);
        for (const file of files) {
            if (file.endsWith(".js")) { // Load only compiled JS files
                const toolPath = path.join(toolsDir, file);
                const toolModule = await import(url.pathToFileURL(toolPath).toString());

                if (
                    toolModule.name &&
                    toolModule.inputSchema &&
                    toolModule.callback
                ) {
                    server.tool(
                        toolModule.name,
                        toolModule.inputSchema,
                        toolModule.callback
                    );
                    console.log(`Loaded tool: ${toolModule.name}`);
                } else {
                    console.warn(`Skipping tool file ${file}: Missing required exports (name, inputSchema, callback)`);
                }
            }
        }
    } catch (error) {
        console.error("Failed to load tools:", error);
    }
}

// --- Server Initialization and Run ---

async function main() {
    console.log("Starting Shelly Forge MCP Server...");

    // Load tools dynamically
    await loadTools(mcp);

    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    console.log("Shelly Forge MCP Server running and connected.");
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).toString()) {
    main().catch((error) => {
        console.error("Failed to start MCP server:", error);
        process.exit(1);
    });
}
