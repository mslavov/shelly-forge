# CLI Command Reference

**Last Updated**: 2025-07-22  
**Purpose**: Complete reference for all Shelly Forge CLI commands

---

## Overview

Shelly Forge provides a comprehensive CLI for managing your Shelly device scripts. All commands follow the pattern:

```bash
shelly-forge <command> [options] [arguments]
```

## Global Options

- `--version` - Display the version number
- `--help` - Display help for any command

---

## Commands

### `init`

Initialize a new Shelly Forge project with TypeScript support and project structure.

```bash
shelly-forge init [project-name]
```

**Arguments:**
- `project-name` (optional) - Name of the project directory to create. Defaults to current directory.

**Example:**
```bash
shelly-forge init my-smart-home
cd my-smart-home
npm install
```

**Creates:**
- Project directory with TypeScript configuration
- Package.json with dependencies
- Solutions configuration file
- Git ignore file
- Source directory structure

---

### `create`

Create a new script for a Shelly device within a solution.

```bash
shelly-forge create <name> <hostname> <solution>
```

**Arguments:**
- `name` - Name of the script (e.g., "thermostat", "mqtt-bridge")
- `hostname` - Device hostname or IP address (supports environment variables like ${DEVICE_IP})
- `solution` - Solution name to add the script to

**Example:**
```bash
# Create a new script for a Shelly Plus 1PM
shelly-forge create heater-control 192.168.1.100 heating-system

# Using environment variable
shelly-forge create light-timer ${BEDROOM_SHELLY} lighting
```

**Result:**
- Creates TypeScript source file in `src/<solution>/<name>.ts`
- Updates `solutions.config.json` with the new script entry
- Configures script for deployment to specified device

---

### `build`

Compile TypeScript scripts to JavaScript for deployment to Shelly devices.

```bash
shelly-forge build
```

**Features:**
- Compiles all TypeScript files in configured solutions
- Bundles dependencies into single files
- Wraps code in IIFE (Immediately Invoked Function Expression)
- Generates source maps for debugging
- Uses hash-based caching to skip unchanged files

**Example:**
```bash
shelly-forge build
# Output: Compiling scripts...
# Output: ✓ heating-system/thermostat.ts → dist/heating-system/thermostat.js
# Output: ✓ lighting/timer.ts → dist/lighting/timer.js
```

---

### `deploy`

Deploy compiled scripts to Shelly devices.

```bash
shelly-forge deploy
```

**Process:**
1. Builds all scripts (if not already built)
2. Uploads scripts to configured devices
3. Creates or updates scripts on devices
4. Optionally enables scripts based on configuration
5. Reports deployment status

**Example:**
```bash
shelly-forge deploy
# Output: Deploying scripts...
# Output: ✓ Deployed thermostat.js to 192.168.1.100
# Output: ✓ Script enabled on device
```

**Configuration:**
Scripts are deployed based on `solutions.config.json`:
```json
{
  "heating": {
    "thermostat": {
      "src": "src/heating/thermostat.ts",
      "device": "${BOILER_IP}",
      "enableOnBoot": true
    }
  }
}
```

---

### `discover`

Discover Shelly devices on your local network using mDNS/Bonjour.

```bash
shelly-forge discover
```

**Output:**
- Lists all discovered Shelly devices
- Shows device model, generation, IP address
- Displays device ID and MAC address
- Indicates authentication status

**Example:**
```bash
shelly-forge discover
# Output: Discovering Shelly devices on the network...
# Output: 
# Output: Found 3 devices:
# Output: 
# Output: 1. Shelly Plus 1PM (Gen 2)
# Output:    IP: 192.168.1.100
# Output:    ID: shellypluspm1-a8032ab12345
# Output:    MAC: A8:03:2A:B1:23:45
# Output: 
# Output: 2. Shelly Pro 4PM (Gen 2)
# Output:    IP: 192.168.1.101
# Output:    ...
```

---

### `logs`

Stream real-time logs from a Shelly device.

```bash
shelly-forge logs <hostname>
```

**Arguments:**
- `hostname` - Device hostname or IP address

**Features:**
- Real-time WebSocket connection to device
- Shows script output and system events
- Useful for debugging deployed scripts
- Press Ctrl+C to stop streaming

**Example:**
```bash
shelly-forge logs 192.168.1.100
# Output: Connecting to device at 192.168.1.100...
# Output: Connected. Streaming logs...
# Output: [12:34:56] Temperature: 22.5°C
# Output: [12:34:57] Heater turned ON
```

---

### `debug`

Toggle debug mode for a script on a Shelly device.

```bash
shelly-forge debug <hostname> <on|off>
```

**Arguments:**
- `hostname` - Device hostname or IP address
- `mode` - Either "on" to enable or "off" to disable debug mode

**Example:**
```bash
# Enable debug mode
shelly-forge debug 192.168.1.100 on

# Disable debug mode
shelly-forge debug 192.168.1.100 off
```

---

### `mcp`

Start the Model Context Protocol (MCP) server for AI-assisted development.

```bash
shelly-forge mcp
```

**Features:**
- Enables AI assistants to interact with Shelly Forge
- Provides all CLI commands as MCP tools
- Used by AI editors like Cursor for automated workflows
- Communicates via stdio

**Usage:**
This command is typically not run directly but configured in your AI editor. For Cursor, add to `.cursorrules`:

```json
{
  "mcpServers": {
    "shelly-forge": {
      "command": "shelly-forge",
      "args": ["mcp"]
    }
  }
}
```

---

## Environment Variables

Shelly Forge supports environment variables in device configuration:

```bash
# .env file
BEDROOM_SHELLY=192.168.1.100
LIVING_ROOM_SHELLY=192.168.1.101
GARAGE_SHELLY=garage-shelly.local
```

Use in `solutions.config.json`:
```json
{
  "lighting": {
    "bedroom": {
      "device": "${BEDROOM_SHELLY}"
    }
  }
}
```

---

## Script Development Workflow

1. **Initialize Project**
   ```bash
   shelly-forge init my-project
   cd my-project
   npm install
   ```

2. **Discover Devices**
   ```bash
   shelly-forge discover
   ```

3. **Create Scripts**
   ```bash
   shelly-forge create thermostat 192.168.1.100 heating
   ```

4. **Develop with TypeScript**
   ```typescript
   // src/heating/thermostat.ts
   Shelly.addStatusHandler((status) => {
     if (status.component === "temperature:0") {
       const temp = status.delta.tC;
       print(`Temperature: ${temp}°C`);
     }
   });
   ```

5. **Build and Deploy**
   ```bash
   shelly-forge build
   shelly-forge deploy
   ```

6. **Monitor Logs**
   ```bash
   shelly-forge logs 192.168.1.100
   ```

---

## Error Handling

Common error scenarios and solutions:

### Device Not Found
```
Error: Could not connect to device at 192.168.1.100
```
**Solution**: Verify device IP, ensure device is on network, check firewall settings.

### Authentication Required
```
Error: Device requires authentication
```
**Solution**: Provide device credentials in environment variables or disable auth for development.

### Script Too Large
```
Error: Script size exceeds device limit (64KB)
```
**Solution**: Optimize code, remove unused imports, enable minification.

### Build Errors
```
Error: TypeScript compilation failed
```
**Solution**: Check TypeScript syntax, ensure all imports are valid, run `npm install` for missing dependencies.

---

## Advanced Usage

### Custom Build Configuration

Override default ESBuild settings by creating `esbuild.config.js`:

```javascript
export default {
  minify: true,
  target: 'es2020',
  format: 'iife'
};
```

### Batch Operations

Deploy to multiple devices using shell scripting:

```bash
# Deploy to all configured devices
for device in $(shelly-forge discover | grep IP | awk '{print $2}'); do
  shelly-forge deploy --device $device
done
```

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Build Shelly Scripts
  run: |
    npm install
    npx shelly-forge build
    
- name: Deploy to Devices
  run: npx shelly-forge deploy
  env:
    DEVICE_IP: ${{ secrets.SHELLY_DEVICE_IP }}
```

---

## See Also

- [System Overview](../system-overview.md) - Architecture details
- [Getting Started Guide](../getting-started.md) - Quick start tutorial
- [API Reference](api-reference.md) - Shelly device API documentation