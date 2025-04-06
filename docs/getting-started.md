# Getting Started with Shelly Forge (AI-Assisted Workflow)

This guide walks you through creating your first Shelly script solution using
`shelly-forge` with the help of an AI coding assistant like Cursor. This
approach simplifies development by letting the AI handle device discovery and
boilerplate setup.

## Prerequisites

- Node.js and npm installed.
- An AI coding assistant (e.g., Cursor) integrated into your editor.
- Shelly devices connected to your local network.
- The `shelly-forge` framework (the AI assistant might handle parts of this
  setup if working within an existing project).

## Steps

1. **Initialize Your Project:** If you haven't already, create a new
   `shelly-forge` project. Open your terminal and run:
   ```bash
   npx shelly-forge init my-shelly-project
   cd my-shelly-project
   npm install
   ```
   Open this `my-shelly-project` folder in your AI-powered editor.

2. **Describe Your Goal to the AI:** Instead of manually creating files and
   looking up device IPs, simply tell your AI assistant what you want to
   achieve. For example:

   > "Create a new shelly-forge solution named 'patio_lights' that turns on the
   > light connected to my Shelly Plug S every day at sunset."

3. **AI-Powered Device Discovery:** The AI assistant, leveraging the built-in
   MCP (Model Context Protocol) server within `shelly-forge`, will understand
   that it needs to know _which_ Shelly device is the target.
   - It will initiate a scan of your local network to find available Shelly
     devices.
   - The assistant will then likely present you with a list of discovered
     devices.

   > **AI:** "I found the following Shelly devices on your network:
   >
   > 1. `shelly-plug-s-AABBCC` (192.168.1.55)
   > 2. `shelly-dimmer-123456` (192.168.1.60) Which one is the patio light?"

4. **Select Your Device:** Respond to the AI assistant, indicating the correct
   device.

   > **You:** "Use `shelly-plug-s-AABBCC`."

5. **AI Generates Code and Configuration:** Based on your initial goal and the
   selected device, the AI will:
   - Generate the necessary TypeScript code (e.g.,
     `src/patio_lights/sunset_trigger.ts`) containing the logic to interact with
     the Shelly device API (like getting sunset times and controlling the
     switch).
   - Automatically update the `solutions.config.json` file, creating the
     `patio_lights` solution and linking your new script to the chosen device's
     hostname or IP.

6. **Start Development/Deployment:** The AI will likely guide you on the next
   steps. You can typically start the development server to test your script:
   ```bash
   npm run dev
   ```
   This command compiles your TypeScript, deploys it to the selected device, and
   shows real-time logs in your terminal.

## Benefits of the AI Workflow

- **No Manual IP/Hostname Lookup:** The AI handles finding your devices.
- **Faster Setup:** Reduces boilerplate code and configuration effort.
- **Focus on Logic:** Allows you to concentrate on the actual script
  functionality rather than the setup details.

This AI-assisted approach streamlines the initial creation process, making it
easier and faster to start building powerful automations for your Shelly devices
with `shelly-forge`.
