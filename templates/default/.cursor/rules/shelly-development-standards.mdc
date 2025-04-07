---
description: Standards and best practices for developing Shelly device solutions
globs: src/**/*.ts, src/**/*.js
alwaysApply: true
---

# Shelly Development Standards

This rule defines standards and best practices for developing solutions for Shelly devices.

## Overview

Shelly scripts run on a modified version of mJS (a subset of JavaScript) and operate in a non-blocking environment that shares CPU time with device firmware. Development must follow specific patterns to ensure reliability and prevent device crashes.

## TypeScript Requirements

- Always use TypeScript for all Shelly solution development
- Use types from the shelly-forge library when available: `node_modules/shelly-forge/types/**/*`
- Define custom types for all data structures and API responses

✅ Correct:
```typescript
export type ThermostatState = "On" | "Off";
export interface Schedule {
  weekDays: boolean[];
  startTime: number;
  endTime: number;
  temperature: number;
}
```

❌ Incorrect:
```javascript
// Using plain JavaScript without types
let state = "Off";
let schedule = {
  weekDays: [false, true, true, true, true, true, false],
  startTime: 6,
  endTime: 9,
  temperature: 39
};
```

## Callback Functions

Due to limitations in the JavaScript engine, avoid deep nesting of anonymous functions as this can crash the device:

✅ Correct:
```typescript
function processResponse(result: any, error_code: number, error_message: string) {
  if (error_code !== 0) {
    print("Error: " + error_message);
    return;
  }
  // Process result
}

Shelly.call("HTTP.GET", { url: "http://example.com/" }, processResponse);
```

❌ Incorrect:
```typescript
Shelly.call(
  "HTTP.GET",
  { url: "http://example.com/" },
  function(result, error_code, error_message) {
    if (error_code !== 0) {
      print("Error: " + error_message);
      Shelly.call(
        "Switch.Set",
        { id: 0, on: false },
        function(res, err_code, err_msg) {
          // More nested callbacks - DANGEROUS!
        }
      );
    }
  }
);
```

## State Management

- Use the Storage/KVS API for persistent state storage
- Create a typed interface around the Storage API for type safety
- Implement the store as a singleton to ensure consistent access

✅ Correct:
```typescript
interface StoreInterface {
  getState: (callback: (result: State) => void) => void;
  setState: (value: State, callback: (result: any) => void) => void;
}

export const store: StoreInterface = {
  getState: function(callback) {
    Shelly.call("KVS.Get", { key: "my.state" }, (result, error_code) => {
      if (error_code === 0) {
        callback(result.value);
      } else {
        callback("Off"); // Default value
      }
    });
  },
  setState: function(value, callback) {
    Shelly.call("KVS.Set", { key: "my.state", value }, (result, error_code) => {
      if (error_code === 0) {
        Shelly.emitEvent("KVS.Set", { key: "my.state", value });
        callback(result);
      } else {
        callback(null);
      }
    });
  }
};
```

## Configuration Management

- Store configuration in a separate file
- Use constants for configuration values
- Document the purpose of each configuration value

✅ Correct:
```typescript
export const CONFIG = {
  checkInterval: 60 * 1000, // 1 minute
  sensorId: "101", // Temperature sensor ID
  switchId: 0, // Switch component ID
  hysteresis: 1, // Temperature variation before action
  defaultTargetTemperature: 39, // Default temperature in Celsius
};
```

## MQTT Integration

- Define MQTT topics in a structured object
- Use type-safe subscription handlers
- Implement bidirectional communication (publish/subscribe)

✅ Correct:
```typescript
const MQTT_TOPICS = {
  states: {
    currentTemperature: "device/temperature/current",
  },
  controls: {
    targetTemperature: "device/temperature/target",
  },
};

// Subscribe to control topics
MQTT.subscribe(MQTT_TOPICS.controls.targetTemperature, (topic, message) => {
  store.setTargetTemperature(parseFloat(message), (result) => {
    console.log("Temperature updated:", result);
  });
});

// Publish state updates
Timer.set(60000, true, () => {
  store.getTargetTemperature((temperature) => {
    MQTT.publish(MQTT_TOPICS.states.targetTemperature, temperature.toString());
  });
});
```

## Project Structure

- Organize code into logical modules with clear responsibilities
- Implement solution-specific logic in separate files
- Use a modular approach for reusable components

Recommended structure:
```
src/
  ├── solution-name/
  │   ├── config.ts          # Configuration constants
  │   ├── store.ts           # State management
  │   ├── main.ts            # Core application logic
  │   ├── mqtt.ts            # MQTT integration (if needed)
  │   └── types.ts           # Type definitions
```


## Performance Considerations

- Avoid blocking operations and infinite loops
- Use timers for periodic tasks instead of continuous polling
- Keep CPU-intensive operations to a minimum
- Implement proper error handling to prevent script crashes

✅ Correct:
```typescript
// Use a timer for periodic checks
Timer.set(60000, true, checkSensor, null);

function checkSensor() {
  // Limited scope, non-blocking operation
}
```

❌ Incorrect:
```typescript
// Potentially blocking loop
let n = 0;
while (n < 500000) {
  n = n + 1;
}
``` 