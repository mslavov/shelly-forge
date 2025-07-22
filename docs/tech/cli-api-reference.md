# CLI API Reference - Shelly Forge

**Last Updated**: 2025-07-22  
**Purpose**: Comprehensive reference for all Shelly Forge CLI commands

---

## Table of Contents

1. [Installation & Basic Usage](#installation--basic-usage)
2. [Command Reference](#command-reference)
   - [init](#init)
   - [create](#create)
   - [build](#build)
   - [deploy](#deploy)
   - [discover](#discover)
   - [logs](#logs)
   - [debug](#debug)
   - [mcp](#mcp)
3. [Common Patterns](#common-patterns)
4. [Environment Variables](#environment-variables)
5. [Configuration Files](#configuration-files)
6. [Error Handling](#error-handling)

---

## Installation & Basic Usage

### Global Installation

```bash
npm install -g shelly-forge
```

### Basic Command Structure

```bash
shelly-forge <command> [options] [arguments]
```

### Getting Help

```bash
shelly-forge --help              # Show all commands
shelly-forge <command> --help    # Show help for specific command
```

---

## Command Reference

### `init`

Initialize a new Shelly script project with templates and configuration.

**Syntax:**
```bash
shelly-forge init [name]
```

**Arguments:**
- `name` (optional): Project name. If omitted, prompts interactively.

**What it does:**
1. Creates a new project directory
2. Copies template files including:
   - TypeScript configuration
   - Basic script example
   - Solution configuration
   - Environment variable template
3. Sets up `.cursor` directory with MCP configuration
4. Initializes git-friendly structure

**Examples:**
```bash
# Interactive mode
shelly-forge init

# With project name
shelly-forge init my-smart-home

# Creates directory structure:
# my-smart-home/
# ├── src/
# │   └── default/
# │       └── example.ts
# ├── tsconfig.json
# ├── solutions.config.json
# ├── .env.example
# └── package.json
```

---

### `create`

Create a new Shelly script within an existing project.

**Syntax:**
```bash
shelly-forge create <name> <hostname> [solution]
```

**Arguments:**
- `name` (required): Name of the script
- `hostname` (required): Hostname or IP address of the target Shelly device
- `solution` (optional): Solution name for organizing scripts (default: "default")

**What it does:**
1. Creates TypeScript file at `src/{solution}/{name}.ts`
2. Adds "Hello World" template with proper Shelly type imports
3. Updates `solutions.config.json` with device mapping
4. Ensures directory structure exists

**Examples:**
```bash
# Basic usage
shelly-forge create temperature-monitor 192.168.1.100

# With custom solution
shelly-forge create motion-sensor shelly-plus-1pm.local security

# Using environment variables for hostname
SHELLY_KITCHEN=192.168.1.101
shelly-forge create kitchen-lights $SHELLY_KITCHEN kitchen
```

**Generated Script Template:**
```typescript
/// <reference types="../../types/shellyapi" />

console.log("Hello from temperature-monitor!");

// Add your script logic here
```

---

### `build`

Build all TypeScript scripts into device-compatible JavaScript.

**Syntax:**
```bash
shelly-forge build
```

**Arguments:** None

**What it does:**
1. Reads all scripts from `solutions.config.json`
2. Bundles each TypeScript file using esbuild
3. Outputs to `dist/{solution}-{name}.js`
4. Applies optimizations:
   - Minification for size constraints
   - IIFE wrapping for scope isolation
   - Arrow function transpilation for compatibility
5. Injects environment variables (SHELLY_PUBLIC_*)

**Build Configuration:**
- **Platform**: Browser
- **Format**: IIFE (Immediately Invoked Function Expression)
- **Target**: ES5-compatible JavaScript
- **Minification**: Enabled
- **Source Maps**: Disabled (for size)

**Examples:**
```bash
# Build all scripts
shelly-forge build

# Output:
# Building scripts...
# ✓ Built default-temperature-monitor
# ✓ Built security-motion-sensor
# Build complete!
```

**Environment Variable Support:**
```typescript
// In your script
const apiKey = process.env.SHELLY_PUBLIC_API_KEY;

// In .env
SHELLY_PUBLIC_API_KEY=your-api-key

// After build, becomes:
const apiKey = "your-api-key";
```

---

### `deploy`

Deploy built scripts to Shelly devices.

**Syntax:**
```bash
shelly-forge deploy [scriptName]
```

**Arguments:**
- `scriptName` (optional): Deploy specific script only. If omitted, deploys all changed scripts.

**What it does:**
1. Checks for built scripts in `dist/` directory
2. Compares file hashes to detect changes
3. Only deploys scripts that have been modified
4. For each deployment:
   - Uploads script to device via HTTP API
   - Sets script name on device
   - Optionally enables script on boot
5. Updates hash cache for change detection

**Examples:**
```bash
# Deploy all changed scripts
shelly-forge deploy

# Deploy specific script
shelly-forge deploy temperature-monitor

# Output:
# Deploying scripts...
# ✓ Deployed temperature-monitor to 192.168.1.100
# ✓ Script enabled on boot
# Deployment complete!
```

**Error Handling:**
- Validates device connectivity before deployment
- Retries failed deployments (configurable)
- Reports specific errors (auth, network, etc.)

---

### `discover`

Discover Shelly devices on the local network using mDNS.

**Syntax:**
```bash
shelly-forge discover [--scanDurationSeconds <seconds>]
```

**Options:**
- `--scanDurationSeconds` (optional): Scan duration in seconds (1-60, default: 5)

**What it does:**
1. Broadcasts mDNS queries for HTTP services
2. Filters responses for Shelly devices
3. Extracts device information:
   - Device name and model
   - IP address and port
   - Device ID
   - Generation (Gen 2/3)
4. Returns JSON array of discovered devices

**Examples:**
```bash
# Quick 5-second scan
shelly-forge discover

# Extended 15-second scan
shelly-forge discover --scanDurationSeconds 15

# Output (JSON):
[
  {
    "name": "ShellyPlus1PM-A8032AB12345",
    "address": "192.168.1.100",
    "port": 80,
    "hostname": "ShellyPlus1PM-A8032AB12345.local",
    "model": "ShellyPlus1PM",
    "id": "A8032AB12345"
  }
]
```

**Network Requirements:**
- Devices and development machine on same network
- mDNS/Bonjour enabled on network
- No firewall blocking mDNS (port 5353)

---

### `logs`

Stream real-time logs from Shelly devices via WebSocket.

**Syntax:**
```bash
shelly-forge logs [scriptName]
```

**Arguments:**
- `scriptName` (optional): Stream logs from specific script's device only

**What it does:**
1. Establishes WebSocket connections to device debug endpoints
2. Streams logs in real-time as they occur
3. For multiple devices:
   - Prefixes each log line with device identifier
   - Manages concurrent connections
4. Handles graceful shutdown on Ctrl+C

**Examples:**
```bash
# Stream from all configured devices
shelly-forge logs

# Stream from specific device
shelly-forge logs temperature-monitor

# Output:
# [192.168.1.100] Script started
# [192.168.1.100] Temperature: 22.5°C
# [192.168.1.101] Motion detected
# [192.168.1.101] Turning on lights
```

**Connection Details:**
- **Protocol**: WebSocket (ws://)
- **Endpoint**: `/debug/log`
- **Authentication**: Uses device credentials if configured
- **Reconnection**: Automatic on disconnect

---

### `debug`

Enable or disable debug mode for Shelly scripts.

**Syntax:**
```bash
shelly-forge debug <mode> [scriptName]
```

**Arguments:**
- `mode` (required): Debug mode - "on" or "off"
- `scriptName` (optional): Apply to specific script only

**What it does:**
1. Configures debug level on Shelly devices
2. Enables/disables verbose logging output
3. Affects console.log visibility in scripts
4. Tracks configured devices to avoid duplicates

**Examples:**
```bash
# Enable debug for all scripts
shelly-forge debug on

# Disable debug for specific script
shelly-forge debug off temperature-monitor

# Output:
# Debug mode enabled for 2 devices
# ✓ 192.168.1.100: Debug ON
# ✓ 192.168.1.101: Debug ON
```

**Debug Levels:**
- **OFF**: Only errors are logged
- **ON**: All console outputs are visible

---

### `mcp`

Start the Model Context Protocol server for AI integration.

**Syntax:**
```bash
shelly-forge mcp
```

**Arguments:** None

**What it does:**
1. Starts MCP server on stdio transport
2. Registers all Shelly Forge commands as MCP tools
3. Enables AI assistants to:
   - Discover devices
   - Create and deploy scripts
   - Monitor device logs
   - Manage configurations
4. Runs until terminated (Ctrl+C)

**Examples:**
```bash
# Start MCP server
shelly-forge mcp

# In Claude or other AI tool, configure:
# Command: shelly-forge
# Arguments: ["mcp"]
```

**MCP Tool Registration:**
Each CLI command is exposed as an MCP tool with:
- Structured input schemas
- Type validation
- Error handling
- JSON responses

---

## Common Patterns

### Script Development Workflow

```bash
# 1. Initialize project
shelly-forge init my-home-automation
cd my-home-automation

# 2. Discover devices
shelly-forge discover > devices.json

# 3. Create scripts
shelly-forge create living-room-lights 192.168.1.100
shelly-forge create bedroom-thermostat 192.168.1.101

# 4. Develop scripts (edit src/default/*.ts files)

# 5. Build scripts
shelly-forge build

# 6. Deploy to devices
shelly-forge deploy

# 7. Monitor execution
shelly-forge logs
```

### Solution-Based Organization

```bash
# Create scripts organized by room
shelly-forge create lights shelly-1.local living-room
shelly-forge create thermostat shelly-2.local living-room
shelly-forge create lights shelly-3.local bedroom
shelly-forge create fan shelly-4.local bedroom

# Results in structure:
# src/
#   living-room/
#     lights.ts
#     thermostat.ts
#   bedroom/
#     lights.ts
#     fan.ts
```

---

## Environment Variables

### Build-Time Variables

Variables prefixed with `SHELLY_PUBLIC_` are replaced during build:

```bash
# .env
SHELLY_PUBLIC_API_KEY=abc123
SHELLY_PUBLIC_WEBHOOK_URL=https://example.com/webhook
```

### Device Hostnames

Use environment variables for device management:

```bash
# .env
SHELLY_LIVING_ROOM=192.168.1.100
SHELLY_BEDROOM=192.168.1.101

# solutions.config.json
{
  "default": {
    "lights": {
      "src": "src/default/lights.ts",
      "device": "${SHELLY_LIVING_ROOM}",
      "enableOnBoot": true
    }
  }
}
```

---

## Configuration Files

### solutions.config.json

Main configuration file mapping scripts to devices:

```json
{
  "solution-name": {
    "script-name": {
      "src": "path/to/script.ts",
      "device": "hostname-or-ip",
      "enableOnBoot": true
    }
  }
}
```

### tsconfig.json

TypeScript configuration optimized for Shelly development:

```json
{
  "compilerOptions": {
    "target": "ES5",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["./types/shellyapi"]
  }
}
```

---

## Error Handling

### Common Errors and Solutions

#### Build Errors

```
Error: Cannot find module './config'
```
**Solution**: Ensure all imports use correct paths and files exist.

#### Deployment Errors

```
Error: Authentication required
```
**Solution**: Add device credentials to environment variables:
```bash
SHELLY_AUTH_USER=admin
SHELLY_AUTH_PASS=password
```

#### Network Errors

```
Error: ECONNREFUSED 192.168.1.100:80
```
**Solution**: 
- Verify device IP address
- Check network connectivity
- Ensure device is powered on

#### Script Size Errors

```
Error: Script too large (limit: 64KB)
```
**Solution**:
- Minimize script code
- Remove unnecessary imports
- Split into multiple scripts

### Debug Tips

1. **Enable debug mode**: `shelly-forge debug on`
2. **Check device logs**: `shelly-forge logs`
3. **Verify device info**: Use device's web interface
4. **Test connectivity**: `ping <device-ip>`
5. **Validate scripts**: TypeScript compilation errors appear during build

---

This CLI API reference provides comprehensive documentation for all Shelly Forge commands. For additional help, use `shelly-forge --help` or refer to the project's GitHub repository.