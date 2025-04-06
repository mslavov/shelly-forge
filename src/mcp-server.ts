import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs/promises";
import path from "path";
import url from "url"; // Needed for dynamic imports

// Import commands
import init from "./commands/init.js";
import deploy from "./commands/deploy.js";
import debug from "./commands/debug.js";
import logs from "./commands/logs.js";
import create from "./commands/create.js";
import build from "./commands/build.js";
import { z } from "zod";

// Initialize FastMCP server
const mcp = new McpServer({ name: "shelly-forge" });

// --- Command Wrappers as Tools ---

// Init tool
mcp.tool(
    "initProject",
    "Initialize a new Shelly script project",
    { name: z.string().optional().describe("Project name") },
    async (args) => {
        try {
            await init(args.name);
            return { content: [{ type: "text", text: "Project initialized successfully" }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Init failed: ${(error as Error).message}` }] };
        }
    }
);

// Deploy tool
mcp.tool(
    "deploy",
    "Deploy the script to Shelly device",
    {},
    async () => {
        try {
            await deploy();
            return { content: [{ type: "text", text: "Deployment successful" }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Deployment failed: ${(error as Error).message}` }] };
        }
    }
);

// Debug tool
mcp.tool(
    "toggleDebug",
    "Turn debug mode on/off for a specific script",
    {
        mode: z.enum(["on", "off"]).describe("Debug mode: on or off"),
        scriptName: z.string().optional().describe("Name of the script (optional)")
    },
    async (args) => {
        try {
            await debug(args.mode, args.scriptName);
            return {
                content: [{
                    type: "text",
                    text: `Debug ${args.mode} set successfully for ${args.scriptName || "all scripts"}`
                }]
            };
        } catch (error) {
            return { content: [{ type: "text", text: `Debug toggle failed: ${(error as Error).message}` }] };
        }
    }
);

// Logs tool
mcp.tool(
    "streamLogs",
    "Stream logs from a Shelly script",
    { scriptName: z.string().optional().describe("Name of the script (optional)") },
    async (args) => {
        try {
            // Start logs in a way that won't block (handled by the command itself)
            logs(args.scriptName);
            return {
                content: [{
                    type: "text",
                    text: `Started streaming logs for ${args.scriptName || "all devices"}. Check console output.`
                }]
            };
        } catch (error) {
            return { content: [{ type: "text", text: `Logs failed: ${(error as Error).message}` }] };
        }
    }
);

// Create tool
mcp.tool(
    "createScript",
    "Create a new Shelly script",
    {
        name: z.string().describe("Name of the script"),
        hostname: z.string().describe("Hostname/IP of the Shelly device"),
        solution: z.string().optional().describe("Solution name for organizing scripts")
    },
    async (args) => {
        try {
            await create(args.name, args.hostname, args.solution);
            return { content: [{ type: "text", text: `Script ${args.name} created successfully` }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Create script failed: ${(error as Error).message}` }] };
        }
    }
);

// Build tool
mcp.tool(
    "build",
    "Build all Shelly scripts using esbuild",
    {},
    async () => {
        try {
            await build();
            return { content: [{ type: "text", text: "Build successful" }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Build failed: ${(error as Error).message}` }] };
        }
    }
);

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
                    // Adapt the callback to return in MCP format
                    const adaptedCallback = async (args: any, extra: any) => {
                        const result = await toolModule.callback(args);
                        return { content: [{ type: "text" as const, text: result }] };
                    };

                    server.tool(
                        toolModule.name,
                        `Dynamically loaded tool: ${toolModule.name}`,
                        toolModule.inputSchema.shape,
                        adaptedCallback
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
