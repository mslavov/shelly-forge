# Shelly API Type Reference

**Last Updated**: 2025-07-22  
**Purpose**: Complete API reference for Shelly device scripting

---

## Table of Contents

1. [Overview](#overview)
2. [Global APIs](#global-apis)
   - [Shelly Namespace](#shelly-namespace)
   - [Script Namespace](#script-namespace)
   - [Virtual Component API](#virtual-component-api)
3. [Communication APIs](#communication-apis)
   - [MQTT API](#mqtt-api)
   - [BLE API](#ble-api)
   - [HTTP Server API](#http-server-api)
4. [Utility APIs](#utility-apis)
   - [Timer API](#timer-api)
   - [Helper Functions](#helper-functions)
5. [Usage Examples](#usage-examples)
6. [Best Practices](#best-practices)

---

## Overview

Shelly devices expose a comprehensive JavaScript API for custom scripting. Scripts run in a sandboxed environment with access to device functions, network communication, and various protocols. All API functions are available globally within scripts.

### Type Safety

When using Shelly Forge, include the type reference at the top of your TypeScript files:

```typescript
/// <reference types="../../types/shellyapi" />
```

This enables full IntelliSense and type checking for all Shelly APIs.

---

## Global APIs

### Shelly Namespace

The main namespace for device interaction and RPC communication.

#### `Shelly.call()`

Invokes an RPC method on the local device.

```typescript
Shelly.call(
    method: string,
    params: object | string,
    callback?: (
        result: object | null | undefined,
        error_code: number,
        error_message: string,
        userdata?: any
    ) => void,
    userdata?: any
): void
```

**Parameters:**
- `method`: Name of the RPC method (e.g., "Switch.Set", "Sys.GetStatus")
- `params`: Method parameters as object or JSON string
- `callback`: Optional callback for async handling
- `userdata`: Optional data passed to callback

**Example:**
```typescript
// Synchronous call (blocking)
Shelly.call("Switch.Set", { id: 0, on: true });

// Asynchronous call with callback
Shelly.call(
    "Switch.Toggle", 
    { id: 0 },
    (result, error_code, error_message) => {
        if (error_code === 0) {
            print("Switch toggled:", JSON.stringify(result));
        } else {
            print("Error:", error_message);
        }
    }
);
```

#### `Shelly.addEventHandler()`

Registers a handler for device events.

```typescript
Shelly.addEventHandler(
    callback: (event_data: object, userdata?: any) => void,
    userdata?: any
): number
```

**Returns:** Subscription handle for later removal

**Event Structure:**
```typescript
{
    component: string,      // Component type (e.g., "switch", "input")
    id: number,            // Component instance ID
    event: string,         // Event name (e.g., "btn_down", "toggle")
    info: object          // Event-specific information
}
```

**Example:**
```typescript
const eventHandle = Shelly.addEventHandler((event) => {
    if (event.component === "input" && event.event === "btn_down") {
        print("Button pressed on input", event.id);
    }
});
```

#### `Shelly.addStatusHandler()`

Registers a handler for status changes.

```typescript
Shelly.addStatusHandler(
    callback: (status_data: object, userdata?: any) => void,
    userdata?: any
): number
```

**Example:**
```typescript
const statusHandle = Shelly.addStatusHandler((status) => {
    print("Status update:", JSON.stringify(status));
});
```

#### `Shelly.removeEventHandler()` / `Shelly.removeStatusHandler()`

Removes previously registered handlers.

```typescript
Shelly.removeEventHandler(subscription_handle: number): boolean
Shelly.removeStatusHandler(subscription_handle: number): boolean
```

#### `Shelly.emitEvent()`

Emits custom events to RPC channels.

```typescript
Shelly.emitEvent(name: string, data: any): void
```

**Example:**
```typescript
Shelly.emitEvent("temperature_alert", {
    temperature: 30.5,
    threshold: 30,
    timestamp: Date.now()
});
```

#### `Shelly.getComponentConfig()` / `Shelly.getComponentStatus()`

Retrieves component configuration or status.

```typescript
Shelly.getComponentConfig(type_or_key: string, id?: number): object | null
Shelly.getComponentStatus(type_or_key: string, id?: number): object | null
```

**Examples:**
```typescript
// Get switch 0 configuration
const switchConfig = Shelly.getComponentConfig("switch", 0);

// Get temperature sensor status
const tempStatus = Shelly.getComponentStatus("temperature", 100) as TemperatureStatus;
if (tempStatus) {
    print(`Temperature: ${tempStatus.tC}°C`);
}
```

#### `Shelly.getDeviceInfo()`

Retrieves device information.

```typescript
Shelly.getDeviceInfo(): object
```

**Returns:**
```typescript
{
    id: string,          // Device ID
    mac: string,         // MAC address
    model: string,       // Device model
    gen: number,         // Generation (2 or 3)
    fw_id: string,       // Firmware ID
    ver: string,         // Firmware version
    app: string,         // Application name
    profile?: string,    // Device profile
    auth_en: boolean,    // Authentication enabled
    auth_domain: string  // Authentication domain
}
```

#### `Shelly.getCurrentScriptId()` / `Shelly.getUptimeMs()`

Utility functions for script information.

```typescript
Shelly.getCurrentScriptId(): number  // Current script's ID
Shelly.getUptimeMs(): number        // System uptime in milliseconds
```

---

### Script Namespace

Script-specific functionality and storage.

#### `Script.id`

The ID of the running script instance.

```typescript
const scriptId: number = Script.id;
```

#### `Script.storage`

Persistent storage API (similar to Web Storage).

**Limitations:**
- Max key length: 16 bytes
- Max value length: 1024 bytes
- Max items: 12

**Interface:**
```typescript
Script.storage = {
    readonly length: number,
    getItem(key: string): string | null,
    setItem(key: string, value: string): void,
    removeItem(key: string): void,
    clear(): void,
    key(index: number): string | null
}
```

**Example:**
```typescript
// Store configuration
Script.storage.setItem("threshold", "25.5");
Script.storage.setItem("enabled", "true");

// Read configuration
const threshold = parseFloat(Script.storage.getItem("threshold") || "20");
const enabled = Script.storage.getItem("enabled") === "true";

// Iterate through all stored items
for (let i = 0; i < Script.storage.length; i++) {
    const key = Script.storage.key(i);
    if (key) {
        print(`${key}: ${Script.storage.getItem(key)}`);
    }
}
```

---

### Virtual Component API

Create and manage virtual components (switches, sensors, etc.).

#### `Virtual.getHandle()`

Get a handle to a virtual component.

```typescript
Virtual.getHandle(key: string): Virtual | null
```

#### Virtual Interface

```typescript
interface Virtual {
    setValue(new_value: any): void
    getValue(): any
    getStatus(): object | undefined
    getConfig(): object | undefined
    setConfig(config_obj: object): void
    on(event: string, callback: Function): number
    off(listener_id: number): boolean
}
```

**Example:**
```typescript
// Create virtual temperature sensor
const virtualTemp = Virtual.getHandle("temperature:200");
if (virtualTemp) {
    // Set temperature value
    virtualTemp.setValue(22.5);
    
    // Listen for configuration changes
    virtualTemp.on("config_changed", (config) => {
        print("Config updated:", JSON.stringify(config));
    });
}
```

---

## Communication APIs

### MQTT API

Interface for MQTT communication.

#### Connection Management

```typescript
MQTT.isConnected(): boolean
MQTT.setConnectHandler(callback: (userdata?: any) => void, userdata?: any): void
MQTT.setDisconnectHandler(callback: (userdata?: any) => void, userdata?: any): void
```

#### Pub/Sub Operations

```typescript
// Subscribe to topics
MQTT.subscribe(
    topic: string,
    callback: (topic: string, message: string, userdata?: any) => void,
    userdata?: any
): void

// Unsubscribe
MQTT.unsubscribe(topic: string): boolean

// Publish messages
MQTT.publish(
    topic: string,
    message: string,
    qos?: 0 | 1 | 2,    // Default: 0
    retain?: boolean     // Default: false
): boolean
```

**Example:**
```typescript
// Set up MQTT handlers
MQTT.setConnectHandler(() => {
    print("MQTT connected");
    
    // Subscribe to commands
    MQTT.subscribe("shellies/+/command", (topic, message) => {
        print(`Command received on ${topic}: ${message}`);
        // Process command
    });
});

// Publish sensor data
if (MQTT.isConnected()) {
    const data = { temperature: 22.5, humidity: 65 };
    MQTT.publish(
        "home/sensors/living-room",
        JSON.stringify(data),
        1,  // QoS 1
        true // Retained
    );
}
```

---

### BLE API

Bluetooth Low Energy scanning and parsing.

#### Scanner API

```typescript
BLE.Scanner = {
    // Constants
    SCAN_START: number,
    SCAN_STOP: number,
    SCAN_RESULT: number,
    INFINITE_SCAN: number,
    
    // Methods
    Start(options: ScanOptions, callback?: Function, userdata?: any): ScanOptions | null,
    Stop(): boolean,
    isRunning(): boolean,
    GetScanOptions(): ScanOptions | null,
    Subscribe(callback: Function, userdata?: any): number
}
```

**Scan Options:**
```typescript
interface ScanOptions {
    duration_ms?: number,    // Scan duration (use INFINITE_SCAN for continuous)
    active?: boolean,        // Active (true) or passive (false) scan
    interval_ms?: number,    // Scan interval
    window_ms?: number       // Scan window
}
```

**Scan Result:**
```typescript
interface ScanResult {
    addr: string,                    // MAC address
    addr_type: number,               // Address type
    advData: string,                 // Advertisement data (hex)
    scanRsp: string,                 // Scan response (hex)
    rssi: number,                    // Signal strength
    flags?: number,                  // Advertisement flags
    local_name?: string,             // Device name
    manufacturer_data?: { [id: number]: string },
    service_uuids?: string[],
    service_data?: { [uuid: string]: string },
    tx_power_level?: number
}
```

**Example:**
```typescript
// Start BLE scan
const scanOptions = {
    duration_ms: 10000,  // 10 seconds
    active: true
};

BLE.Scanner.Start(scanOptions, (event, result) => {
    if (event === BLE.Scanner.SCAN_RESULT && result) {
        print(`Found device: ${result.addr} (${result.local_name || "Unknown"})`);
        print(`RSSI: ${result.rssi} dBm`);
        
        // Check for specific service
        if (result.service_uuids?.includes("180f")) {  // Battery service
            print("Device has battery service");
        }
    } else if (event === BLE.Scanner.SCAN_STOP) {
        print("Scan completed");
    }
});
```

#### GAP Parsing Utilities

```typescript
BLE.GAP = {
    parseName(advData: string, scanRsp: string): string | null,
    parseManufacturerData(advData: string): { [id: number]: string } | null,
    ParseDataByEIRType(advData: string, type: number): string | null,
    HasService(advData: string, uuid: string): boolean,
    ParseServiceData(advData: string, uuid: string): string | null
}
```

---

### HTTP Server API

Create HTTP endpoints for external access.

```typescript
HTTPServer.registerEndpoint(
    endpoint_name: string,
    callback: (request: Request, response: Response, userdata?: any) => void,
    userdata?: any
): string
```

**Request Object:**
```typescript
interface Request {
    method: string,              // HTTP method (GET, POST, etc.)
    query?: string,              // Query string
    headers: [string, string][], // Header pairs
    body?: string               // Request body
}
```

**Response Object:**
```typescript
interface Response {
    code?: number,               // HTTP status code (default: 200)
    body?: string,               // Response body
    headers?: [string, string][], // Response headers
    send: () => boolean          // Send the response
}
```

**Example:**
```typescript
// Register API endpoint
const endpoint = HTTPServer.registerEndpoint("status", (request, response) => {
    // Parse query parameters
    const params = new URLSearchParams(request.query || "");
    const verbose = params.get("verbose") === "true";
    
    // Get device status
    const status = {
        uptime: Shelly.getUptimeMs(),
        temperature: Shelly.getComponentStatus("temperature", 100),
        switches: []
    };
    
    // Add switch states
    for (let i = 0; i < 2; i++) {
        const switchStatus = Shelly.getComponentStatus("switch", i);
        if (switchStatus) status.switches.push(switchStatus);
    }
    
    // Send response
    response.code = 200;
    response.headers = [["Content-Type", "application/json"]];
    response.body = JSON.stringify(status, null, verbose ? 2 : 0);
    response.send();
});

print("Endpoint registered at:", endpoint);
// Output: /script/{script_id}/status
```

---

## Utility APIs

### Timer API

Create and manage timers for scheduled execution.

```typescript
Timer = {
    set(timeout_ms: number, repeat: boolean, callback: (userdata: any) => void, userdata?: any): number,
    clear(timer_handle: number): boolean,
    getInfo(): object
}
```

**Examples:**

```typescript
// One-time timer
const onceTimer = Timer.set(5000, false, () => {
    print("This runs once after 5 seconds");
});

// Repeating timer
let counter = 0;
const repeatTimer = Timer.set(1000, true, () => {
    counter++;
    print(`Tick ${counter}`);
    
    if (counter >= 10) {
        Timer.clear(repeatTimer);
        print("Timer stopped");
    }
});

// Timer with userdata
const config = { threshold: 25, enabled: true };
Timer.set(2000, true, (data) => {
    if (data.enabled) {
        checkTemperature(data.threshold);
    }
}, config);

// Check active timers
const timerInfo = Timer.getInfo();
print("Active timers:", JSON.stringify(timerInfo));
```

---

### Helper Functions

#### `print()`

Output messages to console/logs.

```typescript
print(...args: any[]): void
```

**Example:**
```typescript
print("Temperature:", 22.5, "°C");
print("Device info:", JSON.stringify(Shelly.getDeviceInfo()));
```

#### `btoh()`

Convert binary string to hexadecimal.

```typescript
btoh(bin: string): string
```

**Example:**
```typescript
const binary = "\x48\x65\x6c\x6c\x6f";
const hex = btoh(binary);  // "48656c6c6f"
print(`Binary to hex: ${hex}`);
```

---

## Usage Examples

### Example 1: Temperature Monitor with Alerts

```typescript
/// <reference types="../../types/shellyapi" />

// Configuration
const TEMP_THRESHOLD = 25.0;
const CHECK_INTERVAL = 30000; // 30 seconds
const MQTT_TOPIC = "home/alerts/temperature";

// Monitor temperature
Timer.set(CHECK_INTERVAL, true, () => {
    const tempStatus = Shelly.getComponentStatus("temperature", 100) as TemperatureStatus;
    
    if (tempStatus && tempStatus.tC > TEMP_THRESHOLD) {
        // Send MQTT alert
        if (MQTT.isConnected()) {
            const alert = {
                device: Shelly.getDeviceInfo().id,
                temperature: tempStatus.tC,
                threshold: TEMP_THRESHOLD,
                timestamp: Date.now()
            };
            
            MQTT.publish(MQTT_TOPIC, JSON.stringify(alert), 1);
            print("Temperature alert sent:", tempStatus.tC, "°C");
        }
        
        // Turn on cooling
        Shelly.call("Switch.Set", { id: 0, on: true });
    }
});
```

### Example 2: Motion-Activated Lighting

```typescript
/// <reference types="../../types/shellyapi" />

// Configuration
const LIGHT_DURATION = 300000; // 5 minutes
let lightTimer: number | null = null;

// Listen for motion events
Shelly.addEventHandler((event) => {
    if (event.component === "input" && event.event === "btn_down") {
        print("Motion detected!");
        
        // Turn on lights
        Shelly.call("Switch.Set", { id: 0, on: true });
        
        // Reset timer if already running
        if (lightTimer !== null) {
            Timer.clear(lightTimer);
        }
        
        // Set new timer to turn off lights
        lightTimer = Timer.set(LIGHT_DURATION, false, () => {
            print("Turning off lights");
            Shelly.call("Switch.Set", { id: 0, on: false });
            lightTimer = null;
        });
    }
});
```

### Example 3: BLE Beacon Scanner

```typescript
/// <reference types="../../types/shellyapi" />

// Track seen devices
const seenDevices = new Set<string>();

// Start continuous BLE scan
BLE.Scanner.Start({
    duration_ms: BLE.Scanner.INFINITE_SCAN,
    active: false  // Passive scan for beacons
}, (event, result) => {
    if (event === BLE.Scanner.SCAN_RESULT && result) {
        // Check for iBeacon
        const manufacturerData = BLE.GAP.parseManufacturerData(result.advData);
        if (manufacturerData && manufacturerData[0x004c]) {  // Apple manufacturer ID
            if (!seenDevices.has(result.addr)) {
                seenDevices.add(result.addr);
                print(`New iBeacon: ${result.addr}, RSSI: ${result.rssi}`);
                
                // Emit event for new beacon
                Shelly.emitEvent("beacon_detected", {
                    address: result.addr,
                    rssi: result.rssi,
                    data: manufacturerData[0x004c]
                });
            }
        }
    }
});

// Stop scan after 1 minute
Timer.set(60000, false, () => {
    BLE.Scanner.Stop();
    print(`Scan complete. Found ${seenDevices.size} beacons`);
});
```

---

## Best Practices

### 1. **Error Handling**

Always handle errors in callbacks:

```typescript
Shelly.call("Switch.Set", { id: 0, on: true }, (result, error_code, error_message) => {
    if (error_code !== 0) {
        print(`Error ${error_code}: ${error_message}`);
        // Handle error appropriately
    }
});
```

### 2. **Resource Management**

Clean up handlers and timers:

```typescript
const handlers: number[] = [];
const timers: number[] = [];

// Track resources
handlers.push(Shelly.addEventHandler(handleEvent));
timers.push(Timer.set(1000, true, tick));

// Cleanup function
function cleanup() {
    handlers.forEach(h => Shelly.removeEventHandler(h));
    timers.forEach(t => Timer.clear(t));
}
```

### 3. **Storage Usage**

Be mindful of storage limitations:

```typescript
// Check storage before writing
if (Script.storage.length < 10) {  // Leave some room
    Script.storage.setItem(key, value);
} else {
    print("Storage full, cleaning up old entries");
    // Implement cleanup logic
}
```

### 4. **Performance Optimization**

- Minimize blocking operations
- Use asynchronous callbacks when possible
- Batch operations where appropriate
- Cache frequently accessed values

### 5. **Memory Management**

- Scripts have limited memory (~64KB code + runtime)
- Avoid creating large objects or arrays
- Clean up unused variables
- Use simple data structures

---

This API reference provides comprehensive documentation for developing Shelly device scripts. For framework-specific features and development workflow, refer to the Shelly Forge documentation.