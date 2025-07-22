# Script Compilation Rules

Shelly devices run Espruino (ES5). TypeScript provides dev-time safety but must compile to ES5.

## Compilation Settings

### ESBuild Configuration
```javascript
{
    entryPoints: ['src/solution/script.ts'],
    outfile: 'dist/solution-script.js',
    bundle: true,
    format: 'iife',        // Required for Shelly
    platform: 'browser',   // Not Node.js!
    target: 'es5',         // Espruino compatibility
    minify: true,          // Size constraints
    keepNames: false,      // Smaller output
    supported: {
        arrow: false       // No arrow functions!
    }
}
```

## Size Constraints

### 64KB Limit
- Maximum script size: ~64KB
- Monitor size during build
- Use minification
- Remove comments

### Size Optimization
```typescript
// Development
function calculateTemperature(fahrenheit: number): number {
    const celsius = (fahrenheit - 32) * 5 / 9;
    return Math.round(celsius * 10) / 10;
}

// Compiles to (minified)
function calculateTemperature(f){return Math.round((f-32)*5/9*10)/10}
```

## ES5 Restrictions

### No Modern Features
```typescript
// DON'T use in scripts
const arrow = () => {};      // No arrow functions
const {a, b} = obj;         // No destructuring
const [...rest] = array;    // No spread
class MyClass {}            // No classes
`template ${string}`;       // No template literals

// DO use
var func = function() {};   // Function expressions
var a = obj.a, b = obj.b;  // Manual destructuring
```

### IIFE Wrapper
All scripts wrapped automatically:
```javascript
(function() {
    // Your script code here
})();
```

## Environment Variables

### Build-Time Injection
```typescript
// In script
const API_KEY = process.env.SHELLY_PUBLIC_API_KEY;

// With SHELLY_PUBLIC_API_KEY="abc123"
// Compiles to:
var API_KEY = "abc123";
```

### Define Configuration
```typescript
const defines = {};
for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('SHELLY_PUBLIC_')) {
        defines[`process.env.${key}`] = JSON.stringify(value);
    }
}
```

## Script Naming

Output follows pattern:
```
dist/{solution}-{scriptName}.js

Examples:
dist/default-temperature.js
dist/kitchen-lights.js
```

## Global APIs

### Available on Device
```javascript
// These work in scripts
Shelly.call("Switch.Set", {id: 0, on: true});
Timer.set(1000, false, callback);
MQTT.publish("topic", "message");
HTTPServer.registerEndpoint("test", handler);
print("Debug message");
```

### NOT Available
```javascript
// These DON'T work
require('module');    // No modules
import {x} from 'y';  // No imports
fs.readFile();        // No Node.js
fetch();              // No fetch API
```

## Build Process

### Command
```bash
shelly-forge build
# Compiles all scripts from solutions.config.json
```

### Build Output
```
Building scripts...
✓ Built default-temperature (2.3KB)
✓ Built kitchen-lights (1.8KB)
Build complete!
```

## Key Rules

1. **Target ES5** - Espruino runtime
2. **No arrow functions** - Use function keyword
3. **64KB size limit** - Monitor and optimize
4. **IIFE format** - Automatic wrapping
5. **No external deps** - Only Shelly APIs

## Don'ts

- DON'T use ES6+ features
- DON'T exceed size limit
- DON'T include source maps
- DON'T use Node.js APIs
- DON'T forget SHELLY_PUBLIC_ prefix