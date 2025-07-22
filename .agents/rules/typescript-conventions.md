# TypeScript Conventions Rules

Shelly Forge uses TypeScript for the CLI tool, while user scripts compile to ES5 for Shelly devices (Espruino).

## CLI Tool TypeScript

### Configuration
```typescript
// tsconfig.json for CLI
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "strict": false,      // Legacy compatibility
    "esModuleInterop": true
  }
}
```

### Import Rules
```typescript
// MUST use .js extension for local imports
import { logger } from '../utils/logger.js';
import type { CommandTool } from './types.js';  // Type imports

// Import order
1. Node built-ins
2. External packages
3. Internal modules
4. Type imports
```

### Type Patterns
```typescript
// Interfaces - PascalCase, no 'I' prefix
interface DeviceConfig {
    hostname: string;
    auth?: Auth;
}

// Always type async returns
async function deploy(): Promise<void> { }

// Avoid any when possible
function process<T>(data: T): T { }  // Good
function process(data: any) { }       // Avoid
```

## User Script TypeScript

### Compilation Target
```typescript
// Scripts compile to ES5 for Espruino
{
  target: 'es5',
  format: 'iife',
  platform: 'browser',
  supported: { arrow: false }  // No arrow functions!
}
```

### Type Reference
```typescript
/// <reference types="../../types/shellyapi" />

// Global APIs available
Shelly.call("Switch.Set", { id: 0, on: true });
Timer.set(1000, false, () => { });
MQTT.publish("topic", "message");
```

### Script Limitations
- NO npm imports
- NO ES6+ features (let/const OK, but no arrows, destructuring, etc.)
- NO Node.js APIs
- ONLY Shelly device APIs available

## Examples

### CLI Code
```typescript
import { z } from 'zod';
import type { CommandTool } from './types.js';

export const myCommand: CommandTool = {
    name: "my-command",
    description: "Does something",
    inputSchema: {
        option: z.string().optional()
    },
    callback: async (args): Promise<Result> => {
        return { status: "success" };
    }
};
```

### User Script
```typescript
/// <reference types="../../types/shellyapi" />

// TypeScript for dev-time safety only
interface Config {
    threshold: number;
}

var config: Config = { threshold: 25 };

Shelly.addEventHandler(function(event) {
    // No arrow functions!
    if (event.event === "btn_down") {
        handleButton();
    }
});
```

## Key Rules

1. **CLI uses modern TypeScript** (ES2022)
2. **Scripts compile to ES5** (Espruino runtime)
3. **Always use .js imports** in CLI
4. **No external deps** in user scripts
5. **Type for safety**, not runtime