# Code Style Rules

Consistent code style for readability and maintainability.

## Formatting

### Indentation
```typescript
// Use 2 spaces
function example() {
  if (condition) {
    doSomething();
  }
}
```

### Line Length
```typescript
// Keep under 100 characters
const result = await device.call("Script.Create", {
  name: scriptName,
  code: scriptContent,
  enable: true
});
```

### Semicolons
```typescript
// Always use semicolons
import { logger } from './logger.js';
const result = await operation();
```

## Naming

### Variables and Functions
```typescript
// camelCase
const scriptName = "monitor";
function deployScript() { }
async function getDeviceInfo() { }
```

### Constants
```typescript
// UPPER_SNAKE_CASE for true constants
const MAX_SCRIPT_SIZE = 65536;
const DEFAULT_TIMEOUT = 30000;

// camelCase for config objects
const defaultConfig = {
  timeout: 5000,
  retries: 3
};
```

### Classes and Types
```typescript
// PascalCase
class ShellyDevice { }
interface CommandTool { }
type DeviceConfig = { };
```

## Async/Await

### Always Use Async/Await
```typescript
// GOOD
async function fetchData() {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('Failed:', error);
    throw error;
  }
}

// AVOID promise chains
```

## Imports

### Order
```typescript
// 1. Node built-ins
import * as fs from 'fs-extra';
import * as path from 'path';

// 2. External packages
import { Command } from 'commander';
import chalk from 'chalk';

// 3. Internal modules
import { logger } from '../utils/logger.js';

// 4. Types
import type { CommandTool } from './types.js';
```

### Destructuring
```typescript
// Prefer named imports
import { readFile, writeFile } from 'fs-extra';

// Acceptable for many functions
import * as fs from 'fs-extra';
```

## Functions

### Parameters
```typescript
// Destructure multiple params
async function deploy({ name, device, enableOnBoot }: DeployOptions) {
  // Implementation
}

// Default parameters
async function discover(timeout: number = 5000) {
  // Implementation
}
```

## Objects and Arrays

### Formatting
```typescript
// Multi-line for clarity
const config = {
  name: scriptName,
  device: deviceIp,
  timeout: 30000
};

// Single line for simple
const point = { x: 10, y: 20 };

// Arrays
const commands = [
  'init',
  'build',
  'deploy'
];
```

## Comments

### When to Comment
```typescript
// Explain why, not what
// Use IIFE for device compatibility
const format = 'iife';

// Avoid obvious comments
const timeout = 5000; // Set timeout to 5000 (BAD)
```

### JSDoc
```typescript
/**
 * Deploys a script to a Shelly device
 * @param scriptName - Name of the script
 * @param deviceIp - Device IP address
 * @returns Promise that resolves when complete
 */
export async function deploy(scriptName: string, deviceIp: string): Promise<void> {
  // Implementation
}
```

## Path Handling

```typescript
// Always use path module
import * as path from 'path';
const configPath = path.join(cwd, 'config.json');

// Use getCwd() utility
import { getCwd } from '../utils/get-cwd.js';
const cwd = getCwd();
```

## Key Rules

1. **2 spaces indentation**
2. **Semicolons always**
3. **camelCase for vars/functions**
4. **PascalCase for types/classes**
5. **async/await over promises**

## Don'ts

- DON'T use `var`
- DON'T use `==` (use `===`)
- DON'T use tabs
- DON'T exceed 100 chars/line
- DON'T use snake_case for JS
- DON'T forget semicolons