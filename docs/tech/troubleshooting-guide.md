# Troubleshooting Guide - Shelly Forge

**Last Updated**: 2025-07-22  
**Purpose**: Common issues and solutions for Shelly Forge development

---

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Device Connection Problems](#device-connection-problems)
3. [Script Compilation Errors](#script-compilation-errors)
4. [Deployment Failures](#deployment-failures)
5. [Runtime Errors](#runtime-errors)
6. [Performance Issues](#performance-issues)
7. [MCP Server Issues](#mcp-server-issues)
8. [Debugging Techniques](#debugging-techniques)
9. [FAQ](#faq)

---

## Installation Issues

### Problem: Command not found after installation

**Symptoms:**
```bash
$ shelly-forge --version
bash: shelly-forge: command not found
```

**Solutions:**

1. **Verify global installation:**
```bash
npm list -g shelly-forge
```

2. **Check npm global bin path:**
```bash
npm config get prefix
# Add to PATH: export PATH=$PATH:$(npm config get prefix)/bin
```

3. **Reinstall globally:**
```bash
npm uninstall -g shelly-forge
npm install -g shelly-forge
```

4. **Use npx instead:**
```bash
npx shelly-forge --version
```

### Problem: Node version incompatibility

**Symptoms:**
```
Error: Unsupported Node.js version. Requires Node.js 20.0.0 or higher.
```

**Solutions:**

1. **Check Node version:**
```bash
node --version
```

2. **Update Node.js:**
   - Use [nvm](https://github.com/nvm-sh/nvm):
   ```bash
   nvm install 20
   nvm use 20
   ```
   - Or download from [nodejs.org](https://nodejs.org)

---

## Device Connection Problems

### Problem: Device not discovered

**Symptoms:**
- `shelly-forge discover` returns empty results
- Known devices not appearing in scan

**Solutions:**

1. **Check network connectivity:**
```bash
# Ping device directly
ping 192.168.1.100

# Check if on same network
ip route  # Linux/Mac
ipconfig  # Windows
```

2. **Verify mDNS/Bonjour:**
```bash
# Test mDNS discovery
dns-sd -B _http._tcp  # Mac
avahi-browse -a      # Linux
```

3. **Check firewall settings:**
   - Allow UDP port 5353 (mDNS)
   - Allow TCP port 80 (HTTP)
   - Disable VPN temporarily

4. **Manual device specification:**
```bash
# Skip discovery, use IP directly
shelly-forge create my-script 192.168.1.100
```

### Problem: Authentication errors

**Symptoms:**
```
Error: 401 Unauthorized - Authentication required
```

**Solutions:**

1. **Add credentials to .env:**
```bash
# .env
SHELLY_AUTH_USER=admin
SHELLY_AUTH_PASS=your-password
```

2. **Update device configuration:**
```typescript
// In solutions.config.json
{
  "default": {
    "my-script": {
      "src": "src/default/my-script.ts",
      "device": "192.168.1.100",
      "auth": {
        "username": "${SHELLY_AUTH_USER}",
        "password": "${SHELLY_AUTH_PASS}"
      }
    }
  }
}
```

3. **Temporarily disable authentication:**
   - Access device web UI
   - Go to Settings → Access Control
   - Disable authentication (development only!)

### Problem: Connection timeout

**Symptoms:**
```
Error: ETIMEDOUT - Connection timed out
```

**Solutions:**

1. **Check device status:**
   - Access web UI: `http://device-ip`
   - Verify device is online
   - Check Wi-Fi signal strength

2. **Increase timeout:**
```typescript
// In command options
const TIMEOUT = 30000; // 30 seconds
```

3. **Network troubleshooting:**
```bash
# Trace route to device
traceroute 192.168.1.100  # Mac/Linux
tracert 192.168.1.100     # Windows

# Check for packet loss
ping -c 100 192.168.1.100
```

---

## Script Compilation Errors

### Problem: TypeScript compilation fails

**Symptoms:**
```
Error: Cannot find name 'Shelly'
Error: Property 'call' does not exist on type...
```

**Solutions:**

1. **Add type reference:**
```typescript
/// <reference types="../../types/shellyapi" />

// Your script code here
```

2. **Check tsconfig.json:**
```json
{
  "compilerOptions": {
    "types": ["./types/shellyapi"],
    "typeRoots": ["./types", "./node_modules/@types"]
  }
}
```

3. **Install missing types:**
```bash
npm install
npm run build
```

### Problem: Script too large

**Symptoms:**
```
Error: Script size exceeds limit (65536 bytes)
```

**Solutions:**

1. **Minimize code:**
```typescript
// Before
function calculateTemperatureInCelsius(fahrenheit: number): number {
    const celsius = (fahrenheit - 32) * 5 / 9;
    return Math.round(celsius * 10) / 10;
}

// After
function tempC(f:number):number{return Math.round((f-32)*5/9*10)/10}
```

2. **Remove debug code:**
```typescript
// Use conditional compilation
const DEBUG = false;
if (DEBUG) {
    print("Debug info...");
}
```

3. **Split into multiple scripts:**
```bash
# Create modular scripts
shelly-forge create sensor-reader 192.168.1.100
shelly-forge create actuator-control 192.168.1.101
```

4. **Use build optimizations:**
```json
// In build configuration
{
  "minify": true,
  "treeShaking": true,
  "removeComments": true
}
```

---

## Deployment Failures

### Problem: Deploy command fails

**Symptoms:**
```
Error: Failed to deploy script to device
```

**Solutions:**

1. **Build before deploy:**
```bash
shelly-forge build
shelly-forge deploy
```

2. **Check device storage:**
   - Access device web UI
   - Go to Scripts section
   - Delete unused scripts

3. **Verify script syntax:**
```bash
# Test JavaScript output
node dist/default-my-script.js
```

4. **Deploy specific script:**
```bash
# Deploy only changed script
shelly-forge deploy my-script
```

### Problem: Script not enabled after deployment

**Symptoms:**
- Script uploaded but not running
- No logs appearing

**Solutions:**

1. **Check enableOnBoot setting:**
```json
// solutions.config.json
{
  "default": {
    "my-script": {
      "enableOnBoot": true  // Ensure this is set
    }
  }
}
```

2. **Manually enable script:**
   - Access device web UI
   - Go to Scripts
   - Toggle script to "Enabled"

3. **Check script status via API:**
```bash
curl http://192.168.1.100/rpc/Script.List
```

---

## Runtime Errors

### Problem: Script crashes immediately

**Symptoms:**
- Script starts then stops
- Error in device logs

**Solutions:**

1. **Check syntax errors:**
```typescript
// Common issues
Shelly.call("Switch.Set", { id: 0, on: true }); // Correct
Shelly.call("Switch.Set", { id: 0, on: "true" }); // Wrong - boolean not string
```

2. **Verify component IDs:**
```typescript
// Check available components
const switchStatus = Shelly.getComponentStatus("switch", 0);
if (!switchStatus) {
    print("Error: Switch 0 not found!");
    return;
}
```

3. **Add error handling:**
```typescript
try {
    // Your code here
} catch (e) {
    print("Error:", e.message || e);
}
```

### Problem: Memory errors

**Symptoms:**
```
Error: Out of memory
Script terminated
```

**Solutions:**

1. **Reduce memory usage:**
```typescript
// Avoid large arrays
const data = []; // Bad if grows unbounded

// Use circular buffer instead
const buffer = new Array(100);
let index = 0;
function addData(value) {
    buffer[index] = value;
    index = (index + 1) % buffer.length;
}
```

2. **Clean up resources:**
```typescript
// Clear timers when done
const timer = Timer.set(1000, true, tick);
// Later...
Timer.clear(timer);

// Remove handlers
const handler = Shelly.addEventHandler(handleEvent);
// Later...
Shelly.removeEventHandler(handler);
```

3. **Monitor memory usage:**
```typescript
// Periodically check memory
Timer.set(60000, true, () => {
    Shelly.call("Shelly.GetStatus", {}, (result) => {
        print("RAM free:", result.ram_free);
    });
});
```

---

## Performance Issues

### Problem: Script runs slowly

**Symptoms:**
- Delayed responses
- Missed events
- Timeouts

**Solutions:**

1. **Optimize event handlers:**
```typescript
// Bad - Heavy processing in handler
Shelly.addEventHandler((event) => {
    // Complex calculations
    for (let i = 0; i < 10000; i++) {
        // ...
    }
});

// Good - Defer heavy work
let pendingWork = false;
Shelly.addEventHandler((event) => {
    pendingWork = true;
});

Timer.set(100, true, () => {
    if (pendingWork) {
        pendingWork = false;
        // Do heavy work here
    }
});
```

2. **Reduce timer frequency:**
```typescript
// Bad - Too frequent
Timer.set(10, true, checkSensors);  // Every 10ms

// Good - Reasonable interval
Timer.set(1000, true, checkSensors); // Every second
```

3. **Cache values:**
```typescript
// Cache component status
let cachedStatus = null;
let cacheTime = 0;

function getStatus() {
    const now = Date.now();
    if (!cachedStatus || now - cacheTime > 5000) {
        cachedStatus = Shelly.getComponentStatus("switch", 0);
        cacheTime = now;
    }
    return cachedStatus;
}
```

---

## MCP Server Issues

### Problem: MCP server won't start

**Symptoms:**
```
Error: Failed to start MCP server
```

**Solutions:**

1. **Check if already running:**
```bash
ps aux | grep shelly-forge
killall shelly-forge  # If needed
```

2. **Verify MCP configuration:**
```json
// .cursor/mcp.json
{
  "mcpServers": {
    "shelly-forge": {
      "command": "shelly-forge",
      "args": ["mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

3. **Test manually:**
```bash
shelly-forge mcp
# Should see: "MCP server started..."
```

### Problem: AI can't access Shelly Forge

**Symptoms:**
- Commands not recognized in AI
- "Tool not found" errors

**Solutions:**

1. **Restart AI tool:**
   - Close and reopen Cursor/VS Code
   - Reload window (Cmd+R / Ctrl+R)

2. **Check MCP logs:**
```bash
# In Cursor, view MCP logs
# Developer → Toggle Developer Tools → Console
```

3. **Reinstall in project:**
```bash
npm uninstall shelly-forge
npm install -g shelly-forge
```

---

## Debugging Techniques

### 1. Enable Verbose Logging

```bash
# Set debug environment variable
export DEBUG=shelly-forge:*
shelly-forge deploy
```

### 2. Use Device Web UI

- Access: `http://device-ip`
- Go to Scripts → View Logs
- Enable "Debug" level logging

### 3. Add Debug Output

```typescript
// Temporary debug helpers
function debug(...args) {
    print("[DEBUG]", ...args);
}

debug("State:", JSON.stringify(state));
debug("Event:", event.component, event.event);
```

### 4. Remote Debugging

```typescript
// Create debug endpoint
HTTPServer.registerEndpoint("debug", (req, res) => {
    const debugInfo = {
        uptime: Shelly.getUptimeMs(),
        scriptId: Script.id,
        // Add your state here
    };
    
    res.body = JSON.stringify(debugInfo, null, 2);
    res.send();
});

// Access at: http://device-ip/script/{id}/debug
```

### 5. Test in Isolation

```typescript
// Create test harness
function testFunction() {
    // Test specific functionality
    const result = myFunction(testData);
    print("Test result:", result);
    assert(result === expected, "Test failed!");
}

// Run tests on startup
if (Script.storage.getItem("test_mode") === "true") {
    testFunction();
}
```

---

## FAQ

### Q: Can I use npm packages in scripts?

**A:** No, scripts run in a sandboxed environment without npm/node modules. Only built-in Shelly APIs are available.

### Q: How do I share data between scripts?

**A:** Use:
1. Virtual components for shared state
2. Events (`Shelly.emitEvent()`) for communication
3. HTTP endpoints for external access

### Q: Why does my script work locally but not on device?

**A:** Common causes:
- Using unsupported JavaScript features (check ES5 compatibility)
- Exceeding memory/size limits
- Missing error handling
- Wrong component IDs

### Q: How do I update Shelly Forge?

**A:** 
```bash
npm update -g shelly-forge
# Or specific version
npm install -g shelly-forge@latest
```

### Q: Can I test scripts without a device?

**A:** Limited testing possible:
- Syntax checking via TypeScript
- Unit tests for logic
- But device APIs require actual hardware

### Q: How do I backup my scripts?

**A:** Scripts are in your project's `src/` directory. Use git:
```bash
git init
git add .
git commit -m "Initial scripts"
```

---

## Getting Help

1. **Check documentation:**
   - [CLI Reference](./cli-api-reference.md)
   - [API Reference](./shelly-api-reference.md)
   - [Getting Started](../getting-started.md)

2. **Enable debug mode:**
```bash
shelly-forge debug on
```

3. **Community resources:**
   - GitHub Issues
   - Shelly Forums
   - Discord Community

4. **Report bugs:**
   - Include error messages
   - Provide minimal reproduction
   - Specify device model and firmware

---

This troubleshooting guide covers the most common issues encountered with Shelly Forge. For additional support, consult the community forums or open an issue on GitHub.