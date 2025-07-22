# Troubleshooting Guide

**Last Updated**: 2025-07-22  
**Purpose**: Common issues and solutions for Shelly Forge development

---

## Overview

This guide helps you diagnose and resolve common issues when developing with Shelly Forge. Issues are organized by category with symptoms, causes, and solutions.

## Quick Diagnostics

Run these commands to gather diagnostic information:

```bash
# Check Shelly Forge version
shelly-forge --version

# Verify Node.js version (should be 20.0+)
node --version

# Discover devices on network
shelly-forge discover

# Test device connectivity
ping <device-ip>

# Check device info via curl
curl http://<device-ip>/rpc/Shelly.GetDeviceInfo
```

---

## Network & Discovery Issues

### Problem: No Devices Found During Discovery

**Symptoms:**
- `shelly-forge discover` returns no devices
- Empty device list despite devices being online

**Causes & Solutions:**

1. **Different Network Segments**
   ```bash
   # Check your network interface
   ifconfig  # macOS/Linux
   ipconfig  # Windows
   ```
   - Ensure computer and Shelly devices are on same subnet
   - Check router settings for client isolation

2. **mDNS/Bonjour Blocked**
   - Temporarily disable firewall to test
   - On macOS: System Preferences → Security & Privacy → Firewall
   - On Windows: Windows Defender Firewall settings
   - Add exception for port 5353 (mDNS)

3. **Device mDNS Disabled**
   ```bash
   # Enable mDNS on device
   curl -X POST "http://<device-ip>/rpc/Sys.SetConfig" \
        -d '{"config":{"mdns":{"enable":true}}}'
   ```

### Problem: Device Connection Timeout

**Symptoms:**
- `Error: ETIMEDOUT` when deploying
- Cannot reach device despite successful ping

**Solutions:**

1. **Check Authentication**
   ```bash
   # Test with curl
   curl -u admin:password http://<device-ip>/rpc/Shelly.GetDeviceInfo
   ```
   
2. **Verify Port Access**
   ```bash
   # Test HTTP access
   nc -zv <device-ip> 80
   ```

3. **Reset Network Settings**
   - Hold device button for 10 seconds to factory reset
   - Reconfigure WiFi settings via AP mode

---

## Script Compilation Issues

### Problem: TypeScript Compilation Errors

**Symptoms:**
- `Error: TypeScript compilation failed`
- Red squiggles in editor despite valid Shelly code

**Solutions:**

1. **Missing Type Definitions**
   ```bash
   # Reinstall dependencies
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Import Path Issues**
   ```typescript
   // Wrong - absolute imports don't work
   import { helper } from '/src/utils/helper';
   
   // Correct - relative imports
   import { helper } from './utils/helper';
   ```

3. **TypeScript Version Mismatch**
   ```json
   // package.json - ensure TypeScript 5.0+
   {
     "devDependencies": {
       "typescript": "^5.0.0"
     }
   }
   ```

### Problem: Script Too Large

**Symptoms:**
- `Error: Script size exceeds device limit (64KB)`
- Deployment fails with size error

**Solutions:**

1. **Enable Minification**
   ```javascript
   // esbuild.config.js
   export default {
     minify: true,
     treeShaking: true,
     target: 'es2020'
   };
   ```

2. **Remove Debug Code**
   ```typescript
   // Use conditional compilation
   const DEBUG = false;
   
   if (DEBUG) {
     print("Debug info...");
   }
   ```

3. **Split Large Scripts**
   ```json
   // solutions.config.json - split into multiple scripts
   {
     "heating": {
       "controller": { "src": "src/heating/controller.ts", "device": "${DEVICE}" },
       "scheduler": { "src": "src/heating/scheduler.ts", "device": "${DEVICE}" }
     }
   }
   ```

---

## Deployment Issues

### Problem: Script Not Found on Device

**Symptoms:**
- Deployment appears successful but script isn't on device
- `shelly-forge logs` shows no output

**Solutions:**

1. **Verify Script Creation**
   ```bash
   # List scripts on device
   curl http://<device-ip>/rpc/Script.List
   ```

2. **Check Script Status**
   ```bash
   # Get specific script info
   curl http://<device-ip>/rpc/Script.GetStatus?id=1
   ```

3. **Enable Script Manually**
   ```bash
   # Enable script
   curl -X POST "http://<device-ip>/rpc/Script.SetConfig" \
        -d '{"id":1,"config":{"enable":true}}'
   ```

### Problem: Environment Variables Not Resolved

**Symptoms:**
- `Error: Cannot resolve ${VARIABLE_NAME}`
- Device shows as "undefined" in logs

**Solutions:**

1. **Check .env File**
   ```bash
   # Ensure .env exists and has correct format
   cat .env
   # Should show:
   # DEVICE_IP=192.168.1.100
   # BEDROOM_SHELLY=192.168.1.101
   ```

2. **Load Environment Variables**
   ```bash
   # If using custom .env file
   export $(cat .env.production | xargs)
   shelly-forge deploy
   ```

3. **Use Absolute Values for Testing**
   ```json
   // Temporarily replace variables
   {
     "device": "192.168.1.100"  // Instead of "${DEVICE_IP}"
   }
   ```

---

## Runtime Issues

### Problem: Script Crashes Immediately

**Symptoms:**
- Script stops running after deployment
- Device logs show errors

**Solutions:**

1. **Check Syntax Errors**
   ```typescript
   // Common issue - undefined globals
   // Wrong
   setTimeout(() => {}, 1000);  // setTimeout not available
   
   // Correct
   Timer.set(1000, false, () => {});
   ```

2. **Memory Issues**
   ```typescript
   // Avoid memory leaks
   let data = [];  // Unbounded growth
   
   // Better - use circular buffer
   const MAX_SIZE = 100;
   let data = [];
   function addData(item) {
     data.push(item);
     if (data.length > MAX_SIZE) {
       data.shift();
     }
   }
   ```

3. **Invalid API Calls**
   ```typescript
   // Check component exists
   const status = Shelly.getComponentStatus("switch:0");
   if (!status) {
     print("Error: Switch component not found");
     return;
   }
   ```

### Problem: WebSocket Connection Fails

**Symptoms:**
- `shelly-forge logs` cannot connect
- Real-time features not working

**Solutions:**

1. **Enable WebSocket on Device**
   ```bash
   curl -X POST "http://<device-ip>/rpc/Ws.SetConfig" \
        -d '{"config":{"enable":true}}'
   ```

2. **Check Firewall Rules**
   - Allow WebSocket port (usually 80 or 8080)
   - Test with wscat: `wscat -c ws://<device-ip>/rpc`

3. **Use Polling Alternative**
   ```typescript
   // Fallback to HTTP polling
   Timer.set(5000, true, () => {
     Shelly.call("Switch.GetStatus", { id: 0 }, (result) => {
       print(`Status: ${JSON.stringify(result)}`);
     });
   });
   ```

---

## Device-Specific Issues

### Problem: Gen 2 vs Gen 3 API Differences

**Symptoms:**
- Script works on one device but not another
- API methods return different results

**Solutions:**

```typescript
// Detect generation and adapt
const info = Shelly.getDeviceInfo();
const isGen3 = info.gen >= 3;

if (isGen3) {
  // Use Gen 3 specific features
  Shelly.call("Switch.Set", { id: 0, on: true, toggle_after: 30 });
} else {
  // Gen 2 fallback
  Shelly.call("Switch.Set", { id: 0, on: true });
  Timer.set(30000, false, () => {
    Shelly.call("Switch.Set", { id: 0, on: false });
  });
}
```

### Problem: Component Not Available

**Symptoms:**
- `null` returned from getComponentStatus
- Events not firing for expected components

**Solutions:**

1. **List Available Components**
   ```typescript
   // Discover available components
   ["switch", "input", "temperature", "humidity"].forEach(type => {
     for (let i = 0; i < 4; i++) {
       const config = Shelly.getComponentConfig(type, i);
       if (config) {
         print(`Found: ${type}:${i}`);
       }
     }
   });
   ```

2. **Device Capability Check**
   ```typescript
   // Safe component access
   function safeGetTemp() {
     const temp = Shelly.getComponentStatus("temperature:0");
     if (temp && temp.tC !== undefined) {
       return temp.tC;
     }
     print("Warning: Temperature sensor not available");
     return null;
   }
   ```

---

## Development Environment Issues

### Problem: AI Assistant Not Working

**Symptoms:**
- MCP server fails to start
- AI cannot discover devices

**Solutions:**

1. **Check MCP Configuration**
   ```json
   // .cursor/mcp.json or .vscode/mcp.json
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

2. **Verify MCP Server**
   ```bash
   # Test MCP server manually
   shelly-forge mcp
   # Should show: "MCP server started..."
   ```

3. **Check Logs**
   ```bash
   # Check MCP logs
   tail -f ~/.shelly-forge/mcp.log
   ```

### Problem: Hot Reload Not Working

**Symptoms:**
- Changes not reflected after save
- Need manual rebuild/deploy

**Solutions:**

1. **Check Dev Server**
   ```bash
   # Ensure dev server is running
   npm run dev
   # Should show: "Watching for changes..."
   ```

2. **File Watch Limits**
   ```bash
   # Linux/macOS - increase watch limit
   echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```

---

## Performance Issues

### Problem: Script Running Slowly

**Symptoms:**
- Delayed responses
- Timeouts in operations

**Solutions:**

1. **Optimize Timers**
   ```typescript
   // Inefficient - many timers
   for (let i = 0; i < 100; i++) {
     Timer.set(i * 1000, false, () => doWork(i));
   }
   
   // Better - single timer
   let counter = 0;
   Timer.set(1000, true, () => {
     doWork(counter++);
     if (counter >= 100) Timer.clear(timerHandle);
   });
   ```

2. **Reduce API Calls**
   ```typescript
   // Cache component status
   let cachedStatus = null;
   let lastUpdate = 0;
   
   function getStatus() {
     const now = Date.now();
     if (!cachedStatus || now - lastUpdate > 5000) {
       cachedStatus = Shelly.getComponentStatus("switch:0");
       lastUpdate = now;
     }
     return cachedStatus;
   }
   ```

---

## Debugging Techniques

### Enable Verbose Logging

```typescript
// Debug wrapper
const DEBUG = true;

function debug(msg: string) {
  if (DEBUG) {
    print(`[${new Date().toISOString()}] DEBUG: ${msg}`);
  }
}

// Usage
debug("Starting initialization");
```

### Remote Debugging

```typescript
// Send debug info to external server
function remoteLog(message: string) {
  Shelly.call("HTTP.POST", {
    url: "https://debug.example.com/log",
    body: JSON.stringify({
      device: Shelly.getDeviceInfo().id,
      timestamp: Date.now(),
      message: message
    })
  });
}
```

### State Inspection

```typescript
// Periodic state dump
Timer.set(30000, true, () => {
  const state = {
    uptime: Shelly.getUptimeMs(),
    scriptId: Shelly.getCurrentScriptId(),
    components: {}
  };
  
  ["switch:0", "input:0", "temperature:0"].forEach(comp => {
    state.components[comp] = Shelly.getComponentStatus(comp);
  });
  
  print(`STATE: ${JSON.stringify(state, null, 2)}`);
});
```

---

## Getting Help

### Before Asking for Help

1. **Gather Information**
   ```bash
   shelly-forge --version
   node --version
   npm list shelly-forge
   ```

2. **Create Minimal Reproduction**
   - Isolate the problem
   - Create smallest possible script that shows issue
   - Document steps to reproduce

3. **Check Resources**
   - [GitHub Issues](https://github.com/mslavov/shelly-forge/issues)
   - [Official Shelly Forums](https://community.shelly.cloud/)
   - [API Documentation](https://shelly-api-docs.shelly.cloud/)

### Reporting Issues

Include in your report:
- Shelly Forge version
- Device model and firmware version
- Error messages (complete)
- Minimal code example
- Steps to reproduce

### Community Support

- **Discord**: Join Shelly community servers
- **GitHub Discussions**: Ask questions and share solutions
- **Stack Overflow**: Tag questions with `shelly-forge`

---

## See Also

- [CLI Reference](../tech/cli-reference.md) - Complete command documentation
- [API Reference](../tech/api-reference.md) - Shelly device API details
- [Getting Started](../getting-started.md) - Basic setup and examples
- [System Overview](../system-overview.md) - Architecture details