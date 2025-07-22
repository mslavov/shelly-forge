# Developer Guide - Shelly Forge

**Last Updated**: 2025-07-22  
**Purpose**: Architecture details and contribution guidelines for Shelly Forge development

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Core Components](#core-components)
5. [Adding New Features](#adding-new-features)
6. [Testing](#testing)
7. [Code Style Guide](#code-style-guide)
8. [Contributing](#contributing)
9. [Release Process](#release-process)

---

## Architecture Overview

### Design Principles

Shelly Forge follows these core principles:

1. **Type Safety First**: Full TypeScript implementation with strict typing
2. **Modular Architecture**: Each command is a self-contained module
3. **Developer Experience**: Focus on ease of use and clear error messages
4. **Performance**: Optimize for fast compilation and minimal overhead
5. **Extensibility**: Easy to add new commands and features

### Technology Stack

```
┌─────────────────────────────────────────────────────────┐
│                    TypeScript Layer                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │   Commands  │  │    Utils     │  │   Type Defs    │ │
│  │  (Modules)  │  │  (Helpers)   │  │ (Shelly API)   │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    Core Services                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ CLI Parser  │  │  MCP Server  │  │ Device Manager │ │
│  │ (Commander) │  │ (AI Bridge)  │  │  (Discovery)   │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                  External Dependencies                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │   ESBuild   │  │   Bonjour    │  │   WebSocket    │ │
│  │ (Bundler)   │  │   (mDNS)     │  │ (Real-time)   │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Development Setup

### Prerequisites

- Node.js 20.0+ with npm
- TypeScript 5.0+
- Git
- A Shelly device for testing (optional but recommended)

### Local Development

1. **Clone the repository:**
```bash
git clone https://github.com/your-org/shelly-forge.git
cd shelly-forge
```

2. **Install dependencies:**
```bash
npm install
```

3. **Build the project:**
```bash
npm run build
```

4. **Link for local testing:**
```bash
npm link
```

5. **Run in development mode:**
```bash
npm run dev
```

### Development Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts",
    "prepublishOnly": "npm run build"
  }
}
```

---

## Project Structure

```
shelly-forge/
├── src/
│   ├── commands/              # CLI command modules
│   │   ├── init.ts           # Project initialization
│   │   ├── create.ts         # Script creation
│   │   ├── build.ts          # TypeScript compilation
│   │   ├── deploy.ts         # Device deployment
│   │   ├── discover.ts       # Device discovery
│   │   ├── logs.ts           # Log streaming
│   │   ├── debug.ts          # Debug management
│   │   └── mcp.ts            # MCP server
│   ├── utils/                # Utility functions
│   │   ├── logger.ts         # Logging utilities
│   │   ├── config.ts         # Configuration management
│   │   └── validation.ts     # Input validation
│   ├── shelly-forge.ts       # Main CLI entry
│   ├── mcp-server.ts         # MCP server implementation
│   ├── shelly-device.ts      # Device communication
│   └── script-hash-cache.ts  # Deployment optimization
├── types/
│   └── ShellyAPI.d.ts        # Shelly API type definitions
├── templates/                # Project templates
│   └── default/              # Default template files
├── tests/                    # Test files
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── docs/                     # Documentation
│   ├── tech/                 # Technical docs
│   └── guides/               # User guides
└── dist/                     # Compiled output
```

### Key Files

- **`src/shelly-forge.ts`**: Main entry point, command registration
- **`src/commands/types.ts`**: Command interface definitions
- **`src/utils/logger.ts`**: Centralized logging
- **`types/ShellyAPI.d.ts`**: Complete Shelly API types

---

## Core Components

### 1. Command System

Commands follow a consistent interface:

```typescript
export interface CommandTool {
    name: string;
    description: string;
    inputSchema: { [key: string]: z.ZodTypeAny };
    callback: (args: any) => Promise<any>;
}
```

#### Creating a New Command

```typescript
// src/commands/my-command.ts
import { z } from 'zod';
import { CommandTool } from './types';
import { logger } from '../utils/logger';

export const myCommand: CommandTool = {
    name: "my-command",
    description: "Description of what this command does",
    inputSchema: {
        requiredArg: z.string().describe("Required argument"),
        optionalArg: z.number().optional().describe("Optional argument")
    },
    callback: async (args) => {
        logger.info(`Executing my-command with args:`, args);
        
        try {
            // Command implementation
            const result = await doSomething(args.requiredArg);
            
            return {
                status: "success",
                message: `Command completed: ${result}`
            };
        } catch (error) {
            logger.error("Command failed:", error);
            throw error;
        }
    }
};
```

### 2. Device Communication

The `ShellyDevice` class handles all device interactions:

```typescript
export class ShellyDevice {
    private baseUrl: string;
    private auth?: { username: string; password: string };
    
    constructor(hostname: string, auth?: Auth) {
        this.baseUrl = `http://${hostname}`;
        this.auth = auth;
    }
    
    async call(method: string, params?: any): Promise<any> {
        // RPC call implementation
    }
    
    async uploadScript(name: string, code: string): Promise<void> {
        // Script upload implementation
    }
    
    async enableScript(id: number, enable: boolean): Promise<void> {
        // Script control implementation
    }
}
```

### 3. Build System

The build system uses ESBuild for fast TypeScript compilation:

```typescript
// src/utils/bundler.ts
import * as esbuild from 'esbuild';

export async function bundleScript(entryPoint: string): Promise<string> {
    const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es5',
        minify: true,
        write: false,
        define: getEnvironmentVariables(),
    });
    
    return result.outputFiles[0].text;
}
```

### 4. MCP Server

The MCP server exposes all commands to AI assistants:

```typescript
// src/mcp-server.ts
export class ShellyForgeMCPServer {
    private server: MCPServer;
    
    constructor() {
        this.server = new MCPServer({
            name: "shelly-forge",
            version: "1.0.0"
        });
        
        this.registerTools();
    }
    
    private registerTools() {
        commands.forEach(command => {
            this.server.tool({
                name: command.name,
                description: command.description,
                inputSchema: zodToJsonSchema(command.inputSchema),
                handler: command.callback
            });
        });
    }
}
```

---

## Adding New Features

### 1. Adding a New Command

1. Create a new file in `src/commands/`:
```typescript
// src/commands/backup.ts
export const backupCommand: CommandTool = {
    name: "backup",
    description: "Backup scripts from a device",
    // ... implementation
};
```

2. Import and add to the commands array in `src/commands/index.ts`:
```typescript
import { backupCommand } from './backup';

export const commands = [
    // ... existing commands
    backupCommand
];
```

3. The command is automatically available in CLI and MCP.

### 2. Adding Device Features

Extend the `ShellyDevice` class:

```typescript
// src/shelly-device.ts
export class ShellyDevice {
    // ... existing methods
    
    async getScriptLogs(scriptId: number): Promise<string[]> {
        const result = await this.call("Script.GetDebugLog", { id: scriptId });
        return result.log || [];
    }
}
```

### 3. Adding Type Definitions

Update `types/ShellyAPI.d.ts`:

```typescript
declare namespace Shelly {
    // ... existing definitions
    
    interface NewFeature {
        property: string;
        method(): void;
    }
}
```

---

## Testing

### Unit Tests

```typescript
// tests/unit/commands/build.test.ts
import { buildCommand } from '../../../src/commands/build';

describe('Build Command', () => {
    it('should compile TypeScript to JavaScript', async () => {
        const result = await buildCommand.callback({});
        expect(result.status).toBe('success');
    });
    
    it('should handle compilation errors', async () => {
        // Test error handling
    });
});
```

### Integration Tests

```typescript
// tests/integration/device.test.ts
import { ShellyDevice } from '../../src/shelly-device';

describe('Device Integration', () => {
    let device: ShellyDevice;
    
    beforeAll(() => {
        device = new ShellyDevice(process.env.TEST_DEVICE_IP!);
    });
    
    it('should discover device info', async () => {
        const info = await device.getInfo();
        expect(info).toHaveProperty('id');
        expect(info).toHaveProperty('model');
    });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- build.test.ts

# Run in watch mode
npm test -- --watch
```

---

## Code Style Guide

### TypeScript Guidelines

1. **Use strict TypeScript:**
```typescript
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

2. **Prefer interfaces over type aliases for objects:**
```typescript
// Good
interface DeviceConfig {
    hostname: string;
    port: number;
}

// Avoid for objects
type DeviceConfig = {
    hostname: string;
    port: number;
};
```

3. **Use descriptive variable names:**
```typescript
// Good
const deviceHostname = "192.168.1.100";
const scriptContent = await fs.readFile(path);

// Avoid
const h = "192.168.1.100";
const c = await fs.readFile(path);
```

### Error Handling

Always provide meaningful error messages:

```typescript
try {
    await device.call("Script.Create", params);
} catch (error) {
    throw new Error(
        `Failed to create script on device ${device.hostname}: ${error.message}`
    );
}
```

### Logging

Use structured logging:

```typescript
logger.info("Deploying script", {
    scriptName: name,
    device: hostname,
    size: code.length
});
```

---

## Contributing

### Pull Request Process

1. **Fork and clone** the repository
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make changes** and add tests
4. **Run tests and linting**: `npm test && npm run lint`
5. **Commit with descriptive message**: `git commit -m "feat: add backup command"`
6. **Push to your fork**: `git push origin feature/my-feature`
7. **Create Pull Request** with description of changes

### Commit Message Format

Follow Conventional Commits:

```
feat: add backup command for device scripts
fix: handle authentication errors in deploy command
docs: update API reference for new methods
chore: update dependencies
refactor: simplify device discovery logic
test: add integration tests for MCP server
```

### Code Review Checklist

- [ ] Tests pass
- [ ] Code follows style guide
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
- [ ] Error handling implemented
- [ ] Logging added for debugging

---

## Release Process

### Version Management

Follow Semantic Versioning (SemVer):

- **Major (X.0.0)**: Breaking changes
- **Minor (0.X.0)**: New features, backward compatible
- **Patch (0.0.X)**: Bug fixes

### Release Steps

1. **Update version** in `package.json`
2. **Update CHANGELOG.md** with release notes
3. **Run tests**: `npm test`
4. **Build project**: `npm run build`
5. **Create git tag**: `git tag v1.2.3`
6. **Push tag**: `git push origin v1.2.3`
7. **Publish to npm**: `npm publish`

### Pre-release Testing

```bash
# Pack locally
npm pack

# Install in test project
npm install ../shelly-forge/shelly-forge-1.2.3.tgz

# Test all commands
shelly-forge init test-project
cd test-project
shelly-forge create test-script 192.168.1.100
shelly-forge build
shelly-forge deploy
```

---

## Debugging Tips

### Enable Debug Logging

```bash
# Set debug environment variable
export DEBUG=shelly-forge:*

# Run command with debug output
shelly-forge deploy
```

### Common Issues

1. **TypeScript compilation errors**
   - Check tsconfig.json settings
   - Verify type definitions are correct

2. **Device connection issues**
   - Verify network connectivity
   - Check authentication credentials
   - Test with device web interface

3. **MCP server issues**
   - Check stdio communication
   - Verify JSON schema generation
   - Test with MCP client

### Development Tools

- **VS Code Extensions**:
  - ESLint
  - Prettier
  - TypeScript Error Lens
  
- **Debugging**:
  - Use VS Code debugger with launch.json
  - Add breakpoints in TypeScript files
  - Use `console.log` for script debugging

---

This developer guide provides comprehensive information for contributing to and extending Shelly Forge. For user-facing documentation, see the getting started guide and API reference.