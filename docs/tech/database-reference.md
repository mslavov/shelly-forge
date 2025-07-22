# Data Structures Reference

**Last Updated**: 2025-07-22  
**Purpose**: Complete reference for data structures used in Shelly Forge

---

## Overview

This document provides a comprehensive reference for all data structures, configurations, and schemas used in Shelly Forge development. Understanding these structures is essential for effective script development and system integration.

## Configuration Schemas

### Solutions Configuration

The main configuration file that maps scripts to devices.

**File**: `solutions.config.json`

```typescript
interface SolutionsConfig {
  [solutionName: string]: {
    [componentName: string]: {
      src: string;           // Path to TypeScript source file
      device: string;        // Device hostname/IP (supports ${ENV_VAR})
      enableOnBoot: boolean; // Auto-start script on device boot
    }
  }
}
```

**Example**:
```json
{
  "climate": {
    "temperature-monitor": {
      "src": "src/climate/temperature-monitor.ts",
      "device": "192.168.1.100",
      "enableOnBoot": true
    },
    "humidity-controller": {
      "src": "src/climate/humidity-controller.ts",
      "device": "${BATHROOM_SHELLY}",
      "enableOnBoot": true
    }
  },
  "security": {
    "motion-detector": {
      "src": "src/security/motion-detector.ts",
      "device": "${ENTRANCE_SHELLY}",
      "enableOnBoot": true
    }
  }
}
```

### Project Configuration

**File**: `package.json`

```typescript
interface PackageJson {
  name: string;
  version: string;
  scripts: {
    dev: string;      // Development server command
    build: string;    // Build command
    deploy: string;   // Deploy command
    [key: string]: string;
  };
  dependencies: {
    [packageName: string]: string;
  };
  devDependencies: {
    [packageName: string]: string;
  };
}
```

### TypeScript Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["shelly-forge/types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Device Data Structures

### Device Information

Structure returned by `Shelly.getDeviceInfo()`:

```typescript
interface DeviceInfo {
  id: string;           // Unique device identifier (e.g., "shellyplus1pm-a8032ab12345")
  model: string;        // Model identifier (e.g., "SNSW-001X16EU")
  mac: string;          // MAC address (e.g., "A8:03:2A:B1:23:45")
  gen: number;          // Device generation (2 or 3)
  fw_id: string;        // Firmware ID (e.g., "20230913-114008/v1.14.0-gcb84623")
  ver: string;          // Firmware version (e.g., "1.14.0")
  app: string;          // Application name (e.g., "Plus1PM")
  auth_en: boolean;     // Authentication enabled
  auth_domain: string;  // Authentication domain (e.g., "shellyplus1pm-a8032ab12345")
}
```

### Device Discovery Data

Structure returned by device discovery:

```typescript
interface DiscoveredDevice {
  name: string;         // mDNS name
  host: string;         // Hostname
  addresses: string[];  // IP addresses
  port: number;         // Service port
  txt: {
    id: string;         // Device ID
    model: string;      // Model name
    gen: string;        // Generation
    fw_id: string;      // Firmware ID
    ver: string;        // Version
    app: string;        // Application
    auth_en: string;    // Auth enabled ("true"/"false")
    auth_domain: string; // Auth domain
  };
}
```

---

## Component Structures

### Switch Component

**Status Structure**:
```typescript
interface SwitchStatus {
  id: number;           // Switch ID (0-3)
  source: string;       // Last command source ("init", "WS_in", "http", etc.)
  output: boolean;      // Current state (true = on)
  apower: number;       // Active power in Watts
  voltage: number;      // Voltage in Volts
  current: number;      // Current in Amperes
  aenergy: {
    total: number;      // Total energy in Wh
    by_minute: number[]; // Last 3 minutes in mWh
    minute_ts: number;   // Timestamp of last minute
  };
  temperature: {
    tC: number;         // Temperature in Celsius
    tF: number;         // Temperature in Fahrenheit
  };
}
```

**Configuration Structure**:
```typescript
interface SwitchConfig {
  id: number;
  name: string | null;
  in_mode: "momentary" | "follow" | "flip" | "detached";
  initial_state: "off" | "on" | "restore_last" | "match_input";
  auto_on: boolean;
  auto_on_delay: number;
  auto_off: boolean;
  auto_off_delay: number;
  power_limit: number | null;
  voltage_limit: number | null;
  current_limit: number | null;
}
```

### Input Component

**Status Structure**:
```typescript
interface InputStatus {
  id: number;           // Input ID (0-3)
  state: boolean;       // Current state
  percent: number;      // For analog inputs (0-100)
  xpercent: number;     // Extended precision (0.0-100.0)
}
```

**Event Structure**:
```typescript
interface InputEvent {
  component: string;    // "input:0", "input:1", etc.
  id: number;
  event: "btn_down" | "btn_up" | "single_push" | "double_push" | "triple_push" | "long_push";
  ts: number;           // Timestamp
}
```

### Temperature Component

**Status Structure**:
```typescript
interface TemperatureStatus {
  id: number;           // Sensor ID
  tC: number;           // Temperature in Celsius
  tF: number;           // Temperature in Fahrenheit
}
```

### Humidity Component

**Status Structure**:
```typescript
interface HumidityStatus {
  id: number;           // Sensor ID
  rh: number;           // Relative humidity (0-100%)
}
```

### Cover/Roller Component

**Status Structure**:
```typescript
interface CoverStatus {
  id: number;
  source: string;
  state: "open" | "closed" | "opening" | "closing" | "stopped" | "calibrating";
  apower: number;
  voltage: number;
  current: number;
  pf: number;
  freq: number;
  aenergy: {
    total: number;
    by_minute: number[];
    minute_ts: number;
  };
  current_pos: number;  // Current position (0-100%)
  target_pos: number;   // Target position (0-100%)
  move_timeout: number;
  move_started_at: number;
  calibrating: boolean;
  positioning: boolean;
  safety_switch: boolean;
  overtemperature: boolean;
  overpower: boolean;
  overcurrent: boolean;
  overvoltage: boolean;
  undervoltage: boolean;
  obstruction_detected: boolean;
}
```

---

## Script Structures

### Script Information

Structure for script metadata on device:

```typescript
interface ScriptInfo {
  id: number;           // Script ID (1-10)
  name: string;         // Script name
  enable: boolean;      // Enabled status
  running: boolean;     // Currently running
}
```

### Script Configuration

```typescript
interface ScriptConfig {
  id: number;
  name: string;
  enable: boolean;
  src: string;          // Script source code
}
```

### Script Status

```typescript
interface ScriptStatus {
  id: number;
  running: boolean;
  errors: string[];     // Runtime errors
  mem_used: number;     // Memory usage in bytes
  mem_peak: number;     // Peak memory usage
  mem_free: number;     // Free memory
}
```

---

## Event Structures

### Generic Event

Base structure for all events:

```typescript
interface ShellyEvent {
  component: string;    // Component that generated event
  id: number;          // Component instance ID
  event: string;       // Event type
  ts: number;          // Unix timestamp
  data?: any;          // Event-specific data
}
```

### Status Change Event

```typescript
interface StatusChangeEvent {
  component: string;
  id: number;
  delta: {             // Changed properties only
    [key: string]: any;
  };
  ts: number;
}
```

### Custom Event

Structure for user-emitted events:

```typescript
interface CustomEvent {
  event: string;       // Custom event name
  data: any;          // User-defined data
  ts: number;
}
```

---

## HTTP/RPC Structures

### RPC Request

```typescript
interface RPCRequest {
  id?: number;         // Request ID for correlation
  method: string;      // Method name
  params?: {           // Method parameters
    [key: string]: any;
  };
}
```

### RPC Response

```typescript
interface RPCResponse {
  id?: number;         // Matching request ID
  result?: any;        // Success result
  error?: {
    code: number;      // Error code
    message: string;   // Error message
  };
}
```

### HTTP Request Parameters

```typescript
interface HTTPGetParams {
  url: string;
  headers?: { [key: string]: string };
  timeout?: number;    // Milliseconds
}

interface HTTPPostParams extends HTTPGetParams {
  body: string;
}
```

### HTTP Response

```typescript
interface HTTPResponse {
  code: number;        // HTTP status code
  message: string;     // Status message
  headers: { [key: string]: string };
  body: string;        // Response body
  body_b64?: string;   // Base64 encoded body (if binary)
}
```

---

## Timer Structures

### Timer Handle

```typescript
type TimerHandle = number;  // Opaque handle for timer operations
```

### Timer Parameters

```typescript
interface TimerParams {
  delay_ms: number;    // Delay in milliseconds
  repeat: boolean;     // One-shot or repeating
  callback: (userdata?: any) => void;
  userdata?: any;      // Passed to callback
}
```

---

## BLE Structures

### BLE Scanner Configuration

```typescript
interface BLEScannerConfig {
  duration: number;    // Scan duration in seconds
  active: boolean;     // Active vs passive scanning
}
```

### BLE Advertisement

```typescript
interface BLEAdvertisement {
  addr: string;        // MAC address
  addr_type: number;   // Address type
  rssi: number;        // Signal strength
  advdata?: string;    // Advertisement data (hex)
  scanresp?: string;   // Scan response data (hex)
  flags?: number;      // Advertisement flags
  local_name?: string; // Device name
  manufacturer_data?: { [id: string]: string };
  service_uuids?: string[];
  service_data?: { [uuid: string]: string };
  tx_power?: number;
}
```

---

## Storage Structures

### Key-Value Store

```typescript
interface KVSItem {
  key: string;         // Key name (max 64 chars)
  value: string;       // JSON-encoded value (max 255 chars)
  etag: string;        // Version tag
}
```

### KVS Operations

```typescript
// Set value
interface KVSSetParams {
  key: string;
  value: string;       // Must be JSON-stringified
  etag?: string;       // For conditional updates
}

// Get value
interface KVSGetParams {
  key: string;
}

// Delete value
interface KVSDeleteParams {
  key: string;
  etag?: string;       // For conditional deletion
}

// List keys
interface KVSListParams {
  match?: string;      // Key prefix filter
}
```

---

## Webhook Structures

### Webhook Configuration

```typescript
interface WebhookConfig {
  id: number;
  cid: number;         // Component ID
  event: string;       // Event to trigger on
  enable: boolean;
  urls: string[];      // Target URLs
  ssl_ca?: string;     // Custom CA certificate
}
```

### Webhook Event Data

```typescript
interface WebhookEventData {
  id: string;          // Device ID
  mac: string;         // Device MAC
  model: string;       // Device model
  gen: number;         // Device generation
  fw_ver: string;      // Firmware version
  app: string;         // Application name
  event: string;       // Event type
  component: string;   // Source component
  ts: number;          // Timestamp
  data: any;          // Event-specific data
}
```

---

## Error Codes

Common error codes returned by RPC calls:

```typescript
enum ErrorCode {
  OK = 0,
  UNKNOWN_ERROR = -1,
  INVALID_ARGUMENT = -2,
  DEADLINE_EXCEEDED = -3,
  NOT_FOUND = -4,
  ALREADY_EXISTS = -5,
  PERMISSION_DENIED = -6,
  RESOURCE_EXHAUSTED = -7,
  FAILED_PRECONDITION = -8,
  ABORTED = -9,
  OUT_OF_RANGE = -10,
  UNIMPLEMENTED = -11,
  INTERNAL = -12,
  UNAVAILABLE = -13,
  DATA_LOSS = -14,
  UNAUTHENTICATED = -15,
  
  // Shelly-specific
  INVALID_CONFIG = -100,
  LIMIT_EXCEEDED = -101,
  NO_WIFI_CREDENTIALS = -102,
  WIFI_CONNECT_FAILED = -103,
  FIRMWARE_UPDATE_IN_PROGRESS = -104,
  COMPONENT_NOT_FOUND = -105,
  SCRIPT_ERROR = -106,
  SCRIPT_TOO_LARGE = -107,
  SCRIPT_MEMORY_ERROR = -108,
  SCRIPT_RUNTIME_ERROR = -109,
}
```

---

## Best Practices

### Type Safety

Always use TypeScript interfaces for type safety:

```typescript
// Define expected structure
interface MyConfig {
  threshold: number;
  interval: number;
  enabled: boolean;
}

// Type-safe configuration
const config: MyConfig = {
  threshold: 25,
  interval: 60000,
  enabled: true
};

// Type-safe RPC calls
Shelly.call("KVS.Set", {
  key: "config",
  value: JSON.stringify(config)
}, (result, error_code) => {
  if (error_code === 0) {
    print("Config saved");
  }
});
```

### Data Validation

Always validate data from external sources:

```typescript
function validateTemperature(value: any): number | null {
  if (typeof value !== 'number') return null;
  if (value < -50 || value > 100) return null;
  return value;
}

// Use validation
Shelly.addStatusHandler((status) => {
  if (status.component === "temperature:0") {
    const temp = validateTemperature(status.delta.tC);
    if (temp !== null) {
      processTemperature(temp);
    }
  }
});
```

### Error Handling

Always handle potential errors:

```typescript
function safeCall(method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    Shelly.call(method, params, (result, error_code, error_message) => {
      if (error_code !== 0) {
        print(`Error calling ${method}: ${error_message} (${error_code})`);
        reject(new Error(error_message));
      } else {
        resolve(result);
      }
    });
  });
}
```

---

## See Also

- [API Reference](api-reference.md) - Shelly device API documentation
- [CLI Reference](cli-reference.md) - Command-line interface documentation
- [System Overview](../system-overview.md) - Architecture details
- [Getting Started](../getting-started.md) - Quick start guide