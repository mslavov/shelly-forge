# Shelly API Reference

**Last Updated**: 2025-07-22  
**Purpose**: Complete API reference for Shelly device scripting

---

## Overview

This document provides a comprehensive reference for the Shelly scripting API available when developing scripts with Shelly Forge. All scripts run in a sandboxed JavaScript environment on Shelly devices with access to device-specific APIs.

## Global Objects

### `Shelly`

The main namespace providing access to all Shelly device APIs.

---

## Core Methods

### `Shelly.call()`

Invokes an RPC method on the local device.

```typescript
Shelly.call(
  method: string,
  params: object | string,
  callback?: (result: object | null, error_code: number, error_message: string, userdata?: any) => void,
  userdata?: any
): void
```

**Parameters:**
- `method` - Name of the RPC method to invoke (e.g., "Switch.Set", "HTTP.GET")
- `params` - Parameters for the method (object or JSON string)
- `callback` - Optional callback function called when the RPC completes
- `userdata` - Optional data passed to the callback

**Example:**
```typescript
// Turn on switch 0
Shelly.call("Switch.Set", { id: 0, on: true }, (result, error_code, error_message) => {
  if (error_code === 0) {
    print("Switch turned on successfully");
  } else {
    print(`Error: ${error_message}`);
  }
});

// Make HTTP request
Shelly.call("HTTP.GET", { 
  url: "http://api.example.com/data" 
}, (result, error_code, error_message) => {
  if (result && result.code === 200) {
    print(`Response: ${result.body}`);
  }
});
```

---

### `Shelly.addEventHandler()`

Registers a handler for device events.

```typescript
Shelly.addEventHandler(
  callback: (event: object, userdata?: any) => void,
  userdata?: any
): number
```

**Returns:** Subscription handle (number) that can be used to remove the handler

**Event Object Structure:**
```typescript
interface Event {
  component: string;    // Component that generated the event
  id: number;          // Component instance ID
  event: string;       // Event type
  ts: number;          // Timestamp
  data?: any;          // Event-specific data
}
```

**Example:**
```typescript
// Listen for button events
const eventHandle = Shelly.addEventHandler((event) => {
  if (event.component === "input:0" && event.event === "btn_down") {
    print("Button pressed!");
    Shelly.call("Switch.Toggle", { id: 0 });
  }
});

// Listen for temperature changes
Shelly.addEventHandler((event) => {
  if (event.component === "temperature:0") {
    print(`Temperature changed: ${event.data.tC}°C`);
  }
});
```

---

### `Shelly.addStatusHandler()`

Registers a handler for component status changes.

```typescript
Shelly.addStatusHandler(
  callback: (status: object, userdata?: any) => void,
  userdata?: any
): number
```

**Returns:** Subscription handle (number)

**Status Object Structure:**
```typescript
interface StatusUpdate {
  component: string;    // Component that changed
  id: number;          // Component instance ID
  delta: object;       // Changed properties
  ts: number;          // Timestamp
}
```

**Example:**
```typescript
// Monitor switch status
Shelly.addStatusHandler((status) => {
  if (status.component === "switch:0") {
    if (status.delta.output !== undefined) {
      print(`Switch is now ${status.delta.output ? "ON" : "OFF"}`);
    }
  }
});

// Monitor WiFi status
Shelly.addStatusHandler((status) => {
  if (status.component === "wifi" && status.delta.status) {
    print(`WiFi status: ${status.delta.status}`);
  }
});
```

---

### `Shelly.removeEventHandler()`

Removes a previously registered event handler.

```typescript
Shelly.removeEventHandler(handle: number): boolean
```

**Returns:** `true` if handler was removed, `false` if not found

**Example:**
```typescript
const handle = Shelly.addEventHandler((event) => {
  // Handle events
});

// Later, remove the handler
if (Shelly.removeEventHandler(handle)) {
  print("Event handler removed");
}
```

---

### `Shelly.removeStatusHandler()`

Removes a previously registered status handler.

```typescript
Shelly.removeStatusHandler(handle: number): boolean
```

---

### `Shelly.emitEvent()`

Emits a custom event to all persistent RPC channels.

```typescript
Shelly.emitEvent(name: string, data: any): void
```

**Parameters:**
- `name` - Event name (string)
- `data` - Event payload (must be JSON-serializable)

**Example:**
```typescript
// Emit custom event
Shelly.emitEvent("motion_detected", {
  zone: "entrance",
  confidence: 0.95,
  timestamp: Date.now()
});
```

---

### `Shelly.getComponentConfig()`

Retrieves the configuration of a component.

```typescript
Shelly.getComponentConfig(
  type_or_key: string,
  id?: number
): object | null
```

**Parameters:**
- `type_or_key` - Component type (e.g., "switch") or key (e.g., "switch:0")
- `id` - Component instance ID (if not included in key)

**Example:**
```typescript
// Get switch 0 configuration
const switchConfig = Shelly.getComponentConfig("switch", 0);
if (switchConfig) {
  print(`Switch name: ${switchConfig.name}`);
  print(`Auto-off enabled: ${switchConfig.auto_off}`);
}

// Alternative syntax
const config = Shelly.getComponentConfig("switch:0");
```

---

### `Shelly.getComponentStatus()`

Retrieves the current status of a component.

```typescript
Shelly.getComponentStatus(
  type_or_key: string,
  id?: number
): object | null
```

**Example:**
```typescript
// Get temperature sensor status
const tempStatus = Shelly.getComponentStatus("temperature", 0);
if (tempStatus) {
  print(`Current temperature: ${tempStatus.tC}°C`);
  print(`Humidity: ${tempStatus.rh}%`);
}

// Get switch status
const switchStatus = Shelly.getComponentStatus("switch:0");
if (switchStatus) {
  print(`Switch is ${switchStatus.output ? "ON" : "OFF"}`);
  print(`Power: ${switchStatus.apower}W`);
}
```

---

### `Shelly.getDeviceInfo()`

Retrieves information about the device.

```typescript
Shelly.getDeviceInfo(): DeviceInfo
```

**Returns:**
```typescript
interface DeviceInfo {
  id: string;           // Device ID
  model: string;        // Model identifier
  mac: string;          // MAC address
  gen: number;          // Generation (2 or 3)
  fw_id: string;        // Firmware ID
  ver: string;          // Firmware version
  app: string;          // Application name
  auth_en: boolean;     // Authentication enabled
  auth_domain: string;  // Authentication domain
}
```

**Example:**
```typescript
const info = Shelly.getDeviceInfo();
print(`Device: ${info.model} (Gen ${info.gen})`);
print(`Firmware: ${info.ver}`);
print(`MAC: ${info.mac}`);
```

---

### `Shelly.getCurrentScriptId()`

Gets the ID of the currently running script.

```typescript
Shelly.getCurrentScriptId(): number
```

**Example:**
```typescript
const scriptId = Shelly.getCurrentScriptId();
print(`Running as script #${scriptId}`);
```

---

### `Shelly.getUptimeMs()`

Gets the system uptime in milliseconds.

```typescript
Shelly.getUptimeMs(): number
```

**Example:**
```typescript
const uptime = Shelly.getUptimeMs();
const hours = Math.floor(uptime / (1000 * 60 * 60));
print(`System has been running for ${hours} hours`);
```

---

## Global Functions

### `print()`

Outputs a message to the device console/logs.

```typescript
print(message: any): void
```

**Example:**
```typescript
print("Script started");
print(`Temperature: ${temp}°C`);
print({ status: "OK", value: 42 }); // Objects are JSON-stringified
```

---

## Timer Functions

### `Timer.set()`

Creates a timer that calls a function after a specified delay.

```typescript
Timer.set(
  delay_ms: number,
  repeat: boolean,
  callback: (userdata?: any) => void,
  userdata?: any
): number | null
```

**Parameters:**
- `delay_ms` - Delay in milliseconds
- `repeat` - If true, timer repeats; if false, runs once
- `callback` - Function to call when timer expires
- `userdata` - Optional data passed to callback

**Returns:** Timer handle or null if failed

**Example:**
```typescript
// One-time timer
Timer.set(5000, false, () => {
  print("5 seconds have passed");
});

// Repeating timer
const handle = Timer.set(1000, true, () => {
  print("Tick!");
});

// Timer with userdata
Timer.set(2000, false, (data) => {
  print(`Timer expired for ${data.name}`);
}, { name: "MyTimer" });
```

---

### `Timer.clear()`

Cancels a previously set timer.

```typescript
Timer.clear(handle: number): boolean
```

**Returns:** `true` if timer was cleared, `false` if not found

**Example:**
```typescript
const handle = Timer.set(10000, false, () => {
  print("This won't run");
});

// Cancel the timer
Timer.clear(handle);
```

---

## HTTP Client

Access HTTP functionality through `Shelly.call()`:

### HTTP.GET

```typescript
Shelly.call("HTTP.GET", {
  url: string,
  headers?: object,
  timeout?: number
}, callback);
```

### HTTP.POST

```typescript
Shelly.call("HTTP.POST", {
  url: string,
  body: string,
  headers?: object,
  timeout?: number
}, callback);
```

**Example:**
```typescript
// GET request
Shelly.call("HTTP.GET", {
  url: "https://api.example.com/data",
  headers: { "Authorization": "Bearer token123" }
}, (result, error_code) => {
  if (error_code === 0 && result.code === 200) {
    const data = JSON.parse(result.body);
    print(`Received: ${data.value}`);
  }
});

// POST request
Shelly.call("HTTP.POST", {
  url: "https://api.example.com/update",
  body: JSON.stringify({ temperature: 22.5 }),
  headers: { "Content-Type": "application/json" }
}, (result, error_code) => {
  print(`Response code: ${result.code}`);
});
```

---

## Component Control

### Switch Control

```typescript
// Turn on
Shelly.call("Switch.Set", { id: 0, on: true });

// Turn off
Shelly.call("Switch.Set", { id: 0, on: false });

// Toggle
Shelly.call("Switch.Toggle", { id: 0 });

// Set with auto-off
Shelly.call("Switch.Set", { 
  id: 0, 
  on: true,
  toggle_after: 30 // Auto-off after 30 seconds
});
```

### Cover/Roller Control

```typescript
// Open
Shelly.call("Cover.Open", { id: 0 });

// Close
Shelly.call("Cover.Close", { id: 0 });

// Stop
Shelly.call("Cover.Stop", { id: 0 });

// Go to position
Shelly.call("Cover.GoToPosition", { id: 0, pos: 50 }); // 50%
```

### Light Control

```typescript
// Basic on/off
Shelly.call("Light.Set", { id: 0, on: true });

// Set brightness
Shelly.call("Light.Set", { 
  id: 0, 
  on: true, 
  brightness: 75 
});

// Set RGB color
Shelly.call("Light.Set", { 
  id: 0, 
  on: true,
  rgb: [255, 0, 0] // Red
});
```

---

## BLE (Bluetooth Low Energy)

For devices with BLE support:

### BLE.Scanner.Start

```typescript
Shelly.call("BLE.Scanner.Start", {
  duration: number,  // Scan duration in seconds
  active: boolean    // Active vs passive scanning
});
```

### BLE.Scanner.Stop

```typescript
Shelly.call("BLE.Scanner.Stop", {});
```

**Example:**
```typescript
// Start BLE scan
Shelly.call("BLE.Scanner.Start", { 
  duration: 30,
  active: true 
});

// Listen for BLE events
Shelly.addEventHandler((event) => {
  if (event.component === "ble" && event.event === "scan_result") {
    print(`Found device: ${event.data.addr} (RSSI: ${event.data.rssi})`);
  }
});
```

---

## Best Practices

### 1. Error Handling

Always check error codes in callbacks:

```typescript
Shelly.call("Switch.Set", { id: 0, on: true }, (result, error_code, error_message) => {
  if (error_code !== 0) {
    print(`Error ${error_code}: ${error_message}`);
    return;
  }
  // Success handling
});
```

### 2. Resource Management

Clean up handlers and timers:

```typescript
let eventHandle = null;
let timerHandle = null;

function cleanup() {
  if (eventHandle !== null) {
    Shelly.removeEventHandler(eventHandle);
  }
  if (timerHandle !== null) {
    Timer.clear(timerHandle);
  }
}
```

### 3. Memory Optimization

Be mindful of memory constraints:

```typescript
// Avoid storing large arrays
let readings = []; // Bad if unbounded

// Better: Use circular buffer or aggregate
let lastReading = null;
let readingSum = 0;
let readingCount = 0;
```

### 4. Async Patterns

Use callbacks effectively:

```typescript
function sequence() {
  // Step 1
  Shelly.call("Switch.Set", { id: 0, on: true }, () => {
    // Step 2 (after switch is on)
    Timer.set(1000, false, () => {
      // Step 3 (after delay)
      Shelly.call("Switch.Set", { id: 0, on: false });
    });
  });
}
```

---

## Device-Specific Features

### Shelly Plus Series
- Enhanced processing power
- More memory for scripts
- Additional sensor inputs
- BLE support on some models

### Shelly Pro Series
- Professional features
- Multiple channels
- Enhanced connectivity
- Industrial protocols

### Generation Differences
- **Gen 2**: Original scripting API
- **Gen 3**: Enhanced API with more features

Check device generation with:
```typescript
const info = Shelly.getDeviceInfo();
if (info.gen >= 3) {
  // Use Gen 3 features
}
```

---

## See Also

- [CLI Reference](cli-reference.md) - Shelly Forge command documentation
- [System Overview](../system-overview.md) - Architecture details
- [Official Shelly API Docs](https://shelly-api-docs.shelly.cloud/) - Complete device API documentation