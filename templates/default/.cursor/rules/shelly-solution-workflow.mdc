---
description: Workflow for developing solutions based on Shelly devices
globs: src/**/*.ts, scripts/**/*.ts, docs/**/*.md
alwaysApply: true
---
# Shelly Device Solution Development Workflow

This rule defines the standard workflow for designing and implementing solutions for Shelly devices.

## Solution Design Phase

- Always start by creating a solution design document in the docs/ folder
- Name the file `docs/<solution-name>.md`
- The solution design must be complete before proceeding to implementation
- Design document should include:
  - Solution overview and purpose
  - Required hardware (Shelly devices and peripherals)
  - Logical components and their interactions
  - Required scripts and their functionality
  - Configuration parameters
  - MQTT topics (if applicable)

✅ Correct:
```markdown
# Smart Heating Solution

## Overview
This solution provides zoned heating control using Shelly Plus 1PM devices to control radiator valves.

## Hardware Requirements
- Shelly Plus 1PM (one per zone)
- NTC Temperature Sensors (one per zone)
- Motorized radiator valves (one per zone)

## Components
1. Temperature monitoring script
2. Zone controller script
3. Central scheduler
...
```

## Environment Variable Management

- All device-specific information must be defined as environment variables
- Define device information in `.env` file for actual values
- Document all required variables in `.env.example` with placeholder values
- Prefix variables with `SHELLY_PUBLIC_` if you want to use them within the scripts
- Other env variables are used during build time defined in the solution.config.json
- Include all environment variables in the solution design document

✅ Correct:
```.env.example
# Device Network Configuration
SHELLY_PUBLIC_DEVICE_HOSTNAME=192.168.1.100
SHELLY_PUBLIC_UPDATE_INTERVAL=600
```

✅ Correct Environment Variable Usage in Scripts:
```typescript
// Access environment variables in scripts
const deviceHostname = process.env.SHELLY_PUBLIC_DEVICE_HOSTNAME;
const updateInterval = parseInt(process.env.SHELLY_PUBLIC_UPDATE_INTERVAL || "600");

// Use variables in device calls
Shelly.call("HTTP.GET", {
  url: `http://${deviceHostname}/status`
}, processResponse);
```

### Always use environment variables for device hostnames in the [solutions.config.json](mdc:solutions.config.json) file

## Implementation Phase

- Always refer to the solution design document when creating or updating a solution
- Follow the TypeScript requirements in the development standards
- Ensure component responsibilities match those defined in the design
- Always create scripts with the command, do not manaully add scripts to the @solutions.config.json file

## Use `shelly-forge` MCP Server Tools

### Use `discover` tool to find Shelly devices on the network
**Description:** Discover Shelly devices on the network  
**Parameters:**  
- `scanDurationSeconds` (optional): The number of seconds to scan for Shelly devices (default: 5, min: 1, max: 60)  

Uses mDNS/Bonjour to scan the local network for Shelly devices and returns information about discovered devices including name, IP address, port, model, and ID.

### Use `create` tool to create a new Shelly script  
**Description:** Create a new Shelly script  
**Parameters:**  
- `name`: Name of the script  
- `hostname`: Hostname/IP of the Shelly device  
- `solution` (optional): Solution name for organizing scripts (default: 'default')  

Creates a new script file with basic "Hello World" content and updates the configuration to associate it with the specified Shelly device.

### Use `deploy` tool to Deploy scripts to Shelly devices
**Description:** Deploy scripts to Shelly devices  
**Parameters:**
- `scriptName` (optional): Name of the script to deploy

Deploys all or specfic already built script(s) to their respective Shelly devices as specified in the configuration. Only deploys scripts that have changed since the last deployment.


### Use `build` tool to build Shelly scripts
**Description:** Build all Shelly scripts using esbuild  
**Parameters:** None  

Bundles and minifies all scripts using esbuild for deployment to Shelly devices. Environment variables prefixed with `SHELLY_PUBLIC_` are included in the build.

### `logs`
**Description:** Stream logs from Shelly devices  
**Parameters:**  
- `scriptName` (optional): Name of the script to stream logs from  

Connects to the WebSocket debug interface of Shelly devices to stream real-time logs. Can stream logs from a specific script or from all configured devices.

### `debug`
**Description:** Enable or disable debug mode for Shelly script  
**Parameters:**  
- `mode`: Debug mode: 'on' or 'off'  
- `scriptName` (optional): Name of the script  

Toggles debug mode on specific or all Shelly devices, which enables more verbose logging and debugging capabilities.


## Workflow Order

1. Complete solution design document first
2. Use `discover` to identify available devices
3. Create `.env.example` and `.env` files with device information
4. Use `create` to generate script templates
5. Implement solution logic following development standards
6. Use `build` to verify solution
7. Use `deploy` to install on device
8. Use `debug` and `logs` for troubleshooting

✅ Correct Workflow:
1. Create design document: `docs/smart-heating.md`
2. Discover devices
3. Setup environment files with device information
4. Create script templates
5. Implement solution logic in TypeScript
6. Build solution
7. Deploy to devices
8. Monitor logs

❌ Incorrect Workflow:
1. Start coding without a design document
2. Hardcode device information directly in scripts
3. Deploy untested code directly to devices
4. Debug issues on production devices without local testing 