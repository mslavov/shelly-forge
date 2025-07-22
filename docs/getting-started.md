# Getting Started with Shelly Forge

This comprehensive guide walks you through creating your first Shelly script solutions using Shelly Forge. We'll cover both manual and AI-assisted workflows, provide practical examples, and help you understand the core concepts.

## Prerequisites

- **Node.js 20.0+** and npm installed
- **Shelly devices** (Gen 2 or Gen 3) connected to your local network
- Basic **TypeScript/JavaScript** knowledge
- (Optional) **AI coding assistant** like Cursor for enhanced workflow

## Installation

Install Shelly Forge globally for easy access:

```bash
npm install -g shelly-forge
```

Verify installation:
```bash
shelly-forge --version
```

## Quick Start: Your First Script

### Step 1: Create a New Project

```bash
shelly-forge init my-smart-home
cd my-smart-home
npm install
```

This creates a project structure:
```
my-smart-home/
├── src/              # Your TypeScript scripts
├── dist/             # Compiled JavaScript
├── .env              # Environment variables
├── solutions.config.json  # Device mappings
├── package.json      # Dependencies
└── tsconfig.json     # TypeScript config
```

### Step 2: Discover Your Devices

Find Shelly devices on your network:

```bash
shelly-forge discover
```

Output example:
```
Found 3 devices:

1. Shelly Plus 1PM (Gen 2)
   IP: 192.168.1.100
   ID: shellyplus1pm-a8032ab12345
   MAC: A8:03:2A:B1:23:45

2. Shelly Pro 4PM (Gen 2)
   IP: 192.168.1.101
   ID: shellypro4pm-c8f09e123456
   MAC: C8:F0:9E:12:34:56
```

### Step 3: Create Your First Script

Let's create a simple temperature monitor:

```bash
shelly-forge create temp-monitor 192.168.1.100 climate
```

This creates `src/climate/temp-monitor.ts`. Edit it:

```typescript
// src/climate/temp-monitor.ts

// Temperature monitoring with alerts
const TEMP_THRESHOLD = 25; // Celsius

Shelly.addStatusHandler((status) => {
  if (status.component === "temperature:0" && status.delta.tC !== undefined) {
    const temp = status.delta.tC;
    print(`Current temperature: ${temp}°C`);
    
    if (temp > TEMP_THRESHOLD) {
      print("⚠️ High temperature alert!");
      // Turn on cooling fan connected to switch 0
      Shelly.call("Switch.Set", { id: 0, on: true });
    } else if (temp < TEMP_THRESHOLD - 2) {
      // Turn off fan with hysteresis
      Shelly.call("Switch.Set", { id: 0, on: false });
    }
  }
});

print("Temperature monitor started");
```

### Step 4: Deploy and Test

Build and deploy your script:

```bash
shelly-forge build
shelly-forge deploy
```

Monitor real-time logs:

```bash
shelly-forge logs 192.168.1.100
```

## Practical Examples

### Example 1: Smart Light Timer

Create an automatic light controller that responds to time and motion:

```typescript
// src/lighting/smart-timer.ts

// Configuration
const SUNSET_HOUR = 18; // 6 PM
const SUNRISE_HOUR = 6; // 6 AM
const MOTION_TIMEOUT = 300000; // 5 minutes in ms

let motionTimer: number | null = null;

// Check if it's nighttime
function isNightTime(): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= SUNSET_HOUR || hour < SUNRISE_HOUR;
}

// Handle motion detection
Shelly.addEventHandler((event) => {
  if (event.component === "input:0" && event.event === "btn_down") {
    print("Motion detected!");
    
    if (isNightTime()) {
      // Turn on lights
      Shelly.call("Switch.Set", { id: 0, on: true });
      
      // Clear existing timer
      if (motionTimer !== null) {
        Timer.clear(motionTimer);
      }
      
      // Set new timer to turn off after timeout
      motionTimer = Timer.set(MOTION_TIMEOUT, false, () => {
        print("Motion timeout - turning off lights");
        Shelly.call("Switch.Set", { id: 0, on: false });
        motionTimer = null;
      });
    }
  }
});

// Check time every minute
Timer.set(60000, true, () => {
  if (!isNightTime() && motionTimer === null) {
    // Ensure lights are off during daytime
    Shelly.call("Switch.Get", { id: 0 }, (result) => {
      if (result && result.output === true) {
        print("Daytime - turning off lights");
        Shelly.call("Switch.Set", { id: 0, on: false });
      }
    });
  }
});

print("Smart light timer initialized");
```

### Example 2: Energy Monitor with Alerts

Monitor power consumption and send alerts:

```typescript
// src/energy/power-monitor.ts

const POWER_LIMIT = 2000; // Watts
const ALERT_URL = "https://api.example.com/webhook/power-alert";

// Track power usage
let totalEnergy = 0;
let lastReading = Date.now();

Shelly.addStatusHandler((status) => {
  if (status.component === "switch:0" && status.delta.apower !== undefined) {
    const power = status.delta.apower;
    const now = Date.now();
    const duration = (now - lastReading) / 1000 / 3600; // hours
    
    // Calculate energy consumption
    totalEnergy += power * duration;
    lastReading = now;
    
    print(`Current power: ${power}W, Total today: ${totalEnergy.toFixed(2)}Wh`);
    
    // Check for high power usage
    if (power > POWER_LIMIT) {
      print(`⚠️ High power usage: ${power}W`);
      
      // Send alert via webhook
      Shelly.call("HTTP.POST", {
        url: ALERT_URL,
        body: JSON.stringify({
          device: Shelly.getDeviceInfo().id,
          power: power,
          timestamp: now
        }),
        headers: { "Content-Type": "application/json" }
      }, (result, error_code) => {
        if (error_code === 0) {
          print("Alert sent successfully");
        }
      });
    }
  }
});

// Reset daily counter at midnight
Timer.set(60000, true, () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    print(`Daily energy report: ${totalEnergy.toFixed(2)}Wh`);
    totalEnergy = 0;
  }
});
```

### Example 3: Multi-Device Coordination

Coordinate multiple Shelly devices for a heating system:

```typescript
// src/heating/coordinator.ts

interface HeaterState {
  targetTemp: number;
  currentTemp: number;
  heatingActive: boolean;
}

const state: HeaterState = {
  targetTemp: 22,
  currentTemp: 20,
  heatingActive: false
};

// Monitor temperature from sensor
Shelly.addStatusHandler((status) => {
  if (status.component === "temperature:0" && status.delta.tC !== undefined) {
    state.currentTemp = status.delta.tC;
    updateHeating();
  }
});

function updateHeating() {
  const shouldHeat = state.currentTemp < state.targetTemp - 0.5;
  const shouldStop = state.currentTemp > state.targetTemp + 0.5;
  
  if (shouldHeat && !state.heatingActive) {
    // Turn on heater
    state.heatingActive = true;
    Shelly.call("Switch.Set", { id: 0, on: true });
    print(`Heating ON (current: ${state.currentTemp}°C, target: ${state.targetTemp}°C)`);
    
    // Notify other devices via event
    Shelly.emitEvent("heating_status", {
      active: true,
      temperature: state.currentTemp,
      target: state.targetTemp
    });
    
  } else if (shouldStop && state.heatingActive) {
    // Turn off heater
    state.heatingActive = false;
    Shelly.call("Switch.Set", { id: 0, on: false });
    print(`Heating OFF (current: ${state.currentTemp}°C)`);
    
    Shelly.emitEvent("heating_status", {
      active: false,
      temperature: state.currentTemp,
      target: state.targetTemp
    });
  }
}

// Listen for target temperature changes
Shelly.addEventHandler((event) => {
  if (event.event === "set_target_temp" && event.data.temperature) {
    state.targetTemp = event.data.temperature;
    print(`Target temperature set to ${state.targetTemp}°C`);
    updateHeating();
  }
});
```

## AI-Assisted Workflow

### Setting Up AI Integration

1. **Configure MCP in Cursor**: Add to `.cursor/mcp.json`:
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

2. **Let AI Handle Discovery**: Simply tell the AI:
   > "Create a solution that monitors temperature and controls a fan when it gets too hot"

3. **AI Will**:
   - Discover devices on your network
   - Ask which device to use
   - Generate appropriate code
   - Update configuration files
   - Handle deployment

### AI Workflow Example

**You**: "I want to create a bathroom fan that turns on automatically when humidity is high"

**AI**: 
```
I'll help you create a humidity-controlled bathroom fan. Let me first discover your Shelly devices...

Found devices:
1. Shelly Plus H&T (192.168.1.105) - Temperature & Humidity sensor
2. Shelly Plus 1 (192.168.1.106) - Single relay switch

Which device controls your bathroom fan?
```

**You**: "The Shelly Plus 1 controls the fan"

**AI**: Creates the complete solution with:
- Humidity monitoring from the H&T sensor
- Automatic fan control based on threshold
- Configurable humidity levels
- Timeout to prevent fan running too long

## Working with Solutions

### Solution Configuration

The `solutions.config.json` file maps scripts to devices:

```json
{
  "climate": {
    "temp-monitor": {
      "src": "src/climate/temp-monitor.ts",
      "device": "192.168.1.100",
      "enableOnBoot": true
    },
    "humidity-fan": {
      "src": "src/climate/humidity-fan.ts",
      "device": "${BATHROOM_SHELLY}",
      "enableOnBoot": true
    }
  },
  "lighting": {
    "smart-timer": {
      "src": "src/lighting/smart-timer.ts",
      "device": "${ENTRANCE_SHELLY}",
      "enableOnBoot": true
    }
  }
}
```

### Using Environment Variables

Store device IPs in `.env`:

```bash
# .env
BATHROOM_SHELLY=192.168.1.106
ENTRANCE_SHELLY=192.168.1.107
LIVING_ROOM_SHELLY=192.168.1.108
```

Reference in configuration:
```json
"device": "${BATHROOM_SHELLY}"
```

## Development Workflow

### 1. Live Development Mode

Start the development server for automatic compilation and deployment:

```bash
npm run dev
```

This watches for file changes and automatically:
- Compiles TypeScript to JavaScript
- Deploys to configured devices
- Shows real-time logs

### 2. Manual Build and Deploy

For production deployment:

```bash
# Build all scripts
shelly-forge build

# Deploy to devices
shelly-forge deploy

# Verify deployment
shelly-forge logs 192.168.1.100
```

### 3. Debugging

Enable debug mode for detailed logging:

```bash
shelly-forge debug 192.168.1.100 on
```

Use `print()` statements liberally:
```typescript
print(`Debug: Current state = ${JSON.stringify(state)}`);
```

## Best Practices

### 1. Error Handling

Always handle RPC errors:
```typescript
Shelly.call("Switch.Set", { id: 0, on: true }, (result, error_code, error_message) => {
  if (error_code !== 0) {
    print(`Error: ${error_message} (code: ${error_code})`);
    // Handle error appropriately
  } else {
    print("Switch turned on successfully");
  }
});
```

### 2. Resource Management

Clean up timers and handlers:
```typescript
const handles = {
  timer: null as number | null,
  event: null as number | null,
  status: null as number | null
};

// Set up handlers
handles.event = Shelly.addEventHandler((event) => {
  // Handle events
});

// Cleanup function
function cleanup() {
  if (handles.timer !== null) Timer.clear(handles.timer);
  if (handles.event !== null) Shelly.removeEventHandler(handles.event);
  if (handles.status !== null) Shelly.removeStatusHandler(handles.status);
}
```

### 3. State Management

Use proper state management for complex scripts:
```typescript
interface AppState {
  isActive: boolean;
  lastUpdate: number;
  settings: {
    threshold: number;
    interval: number;
  };
}

const state: AppState = {
  isActive: false,
  lastUpdate: Date.now(),
  settings: {
    threshold: 25,
    interval: 60000
  }
};

// Save state periodically or on change
function saveState() {
  Shelly.call("KVS.Set", {
    key: "app_state",
    value: JSON.stringify(state)
  });
}
```

## Troubleshooting

### Common Issues

1. **Device Not Found**
   - Verify device is on same network
   - Check device IP hasn't changed
   - Ensure device has scripting enabled

2. **Script Too Large**
   - Minimize code, remove comments
   - Split into multiple scripts
   - Use shorter variable names in production

3. **Authentication Errors**
   - Add device credentials to `.env`
   - Temporarily disable auth for development
   - Check device auth settings

4. **Script Not Running**
   - Verify script is enabled on device
   - Check device logs for errors
   - Ensure `enableOnBoot` is set if needed

## Next Steps

- Explore the [CLI Reference](tech/cli-reference.md) for all available commands
- Read the [API Reference](tech/api-reference.md) for device API details
- Check [Example Workflows](guides/example-workflow.md) for more complex scenarios
- Join the community for script sharing and support

## Additional Resources

- [Official Shelly API Documentation](https://shelly-api-docs.shelly.cloud/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Shelly Forge GitHub Repository](https://github.com/mslavov/shelly-forge)

Happy automating with Shelly Forge!