# Developer Guide

**Last Updated**: 2025-07-22  
**Purpose**: Comprehensive guide for developers contributing to or extending Shelly Forge

---

## Overview

This guide provides detailed information for developers who want to contribute to Shelly Forge, extend its functionality, or understand its internal architecture. Whether you're fixing bugs, adding features, or creating plugins, this guide will help you get started.

## Development Environment Setup

### Prerequisites

- **Node.js 20.0+** and npm
- **Git** for version control
- **TypeScript 5.0+** knowledge
- **VS Code** or similar TypeScript-aware editor
- **Shelly devices** for testing (or use mock mode)

### Setting Up the Development Environment

1. **Fork and Clone the Repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/shelly-forge.git
   cd shelly-forge
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

4. **Link for Local Development**
   ```bash
   npm link
   ```

5. **Watch Mode for Development**
   ```bash
   npm run watch
   ```

---

## Architecture Overview

### Project Structure

```
shelly-forge/
├── src/                      # Source code
│   ├── commands/            # CLI command implementations
│   │   ├── build.ts        # Build command
│   │   ├── create.ts       # Create script command
│   │   ├── deploy.ts       # Deploy command
│   │   ├── discover.ts     # Device discovery
│   │   └── ...
│   ├── utils/              # Utility functions
│   │   ├── logger.ts       # Logging utility
│   │   └── cwd.ts          # Working directory utils
│   ├── shelly-forge.ts     # Main CLI entry point
│   ├── mcp-server.ts       # MCP server implementation
│   ├── load-commands.ts    # Dynamic command loader
│   └── shelly-device.ts    # Device communication
├── types/                   # TypeScript definitions
│   ├── ShellyAPI.d.ts      # Shelly API types
│   └── index.d.ts          # Type exports
├── templates/              # Project templates
├── docs/                   # Documentation
└── dist/                   # Compiled output
```

### Core Components

#### 1. Command System

The command system uses Commander.js with dynamic loading:

```typescript
// src/load-commands.ts
export async function loadCommandTools(): Promise<CommandTool[]> {
  const commands: CommandTool[] = [];
  const commandsDir = path.join(__dirname, 'commands');
  
  const files = await fs.readdir(commandsDir);
  for (const file of files) {
    if (file.endsWith('.js')) {
      const module = await import(path.join(commandsDir, file));
      if (module.default) {
        commands.push(module.default);
      }
    }
  }
  
  return commands;
}
```

#### 2. Command Structure

Each command follows this pattern:

```typescript
// src/commands/example.ts
import { z } from 'zod';
import { CommandTool } from '../types';

const inputSchema = z.object({
  param1: z.string().describe("Parameter description"),
  param2: z.number().optional().describe("Optional parameter")
});

const exampleCommand: CommandTool = {
  name: "example",
  description: "Example command description",
  inputSchema,
  callback: async (args) => {
    // Validate inputs
    const params = inputSchema.parse(args);
    
    // Command implementation
    console.log(`Executing with ${params.param1}`);
    
    return "Command completed successfully";
  }
};

export default exampleCommand;
```

#### 3. Device Communication

The `ShellyDevice` class handles all device interactions:

```typescript
// src/shelly-device.ts
export class ShellyDevice {
  constructor(private host: string) {}
  
  async getInfo(): Promise<DeviceInfo> {
    const response = await axios.get(`http://${this.host}/rpc/Shelly.GetDeviceInfo`);
    return response.data.result;
  }
  
  async uploadScript(name: string, code: string): Promise<void> {
    // Script upload implementation
  }
  
  async enableScript(id: number): Promise<void> {
    // Script enabling implementation
  }
}
```

---

## Adding New Commands

### Step 1: Create Command File

Create a new file in `src/commands/`:

```typescript
// src/commands/my-command.ts
import { z } from 'zod';
import { CommandTool } from '../types';
import { logger } from '../utils/logger';

const inputSchema = z.object({
  device: z.string().describe("Device hostname or IP"),
  option: z.boolean().optional().describe("Optional flag")
});

const myCommand: CommandTool = {
  name: "my-command",
  description: "Description of what this command does",
  inputSchema,
  callback: async (args) => {
    const { device, option } = inputSchema.parse(args);
    
    logger.info(`Connecting to device: ${device}`);
    
    // Implementation here
    
    return `Command executed on ${device}`;
  }
};

export default myCommand;
```

### Step 2: Test Your Command

```bash
# Build the project
npm run build

# Test locally
node dist/shelly-forge.js my-command 192.168.1.100 --option
```

### Step 3: Add Tests

Create a test file:

```typescript
// tests/commands/my-command.test.ts
import { describe, it, expect } from '@jest/globals';
import myCommand from '../../src/commands/my-command';

describe('my-command', () => {
  it('should validate input parameters', async () => {
    const result = await myCommand.callback({
      device: '192.168.1.100',
      option: true
    });
    
    expect(result).toContain('Command executed');
  });
  
  it('should reject invalid input', async () => {
    await expect(myCommand.callback({}))
      .rejects.toThrow();
  });
});
```

---

## Working with the MCP Server

### Understanding MCP Integration

The Model Context Protocol (MCP) server enables AI assistants to interact with Shelly Forge:

```typescript
// src/mcp-server.ts
const mcp = new McpServer({
  name: "shelly-forge",
  version: "0.1.0"
});

// Register commands as MCP tools
for (const tool of commandTools) {
  mcp.tool(
    tool.name,
    tool.description,
    tool.inputSchema,
    async (args) => {
      const result = await tool.callback(args);
      return {
        content: [{
          type: "text",
          text: result || "Success"
        }]
      };
    }
  );
}
```

### Adding MCP-Specific Features

To add AI-specific functionality:

```typescript
// Custom MCP tool
mcp.tool(
  "analyze-device",
  "Analyze device capabilities and suggest scripts",
  z.object({
    deviceIp: z.string()
  }),
  async ({ deviceIp }) => {
    const device = new ShellyDevice(deviceIp);
    const info = await device.getInfo();
    
    // AI-friendly analysis
    const analysis = analyzeDeviceCapabilities(info);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(analysis, null, 2)
      }]
    };
  }
);
```

---

## Script Compilation Process

### Understanding ESBuild Integration

The build process uses ESBuild for fast TypeScript compilation:

```typescript
// src/commands/build.ts
import * as esbuild from 'esbuild';

async function compileScript(inputPath: string, outputPath: string) {
  const result = await esbuild.build({
    entryPoints: [inputPath],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outfile: outputPath,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: 'inline',
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });
  
  // Wrap in IIFE for Shelly compatibility
  const code = await fs.readFile(outputPath, 'utf-8');
  const wrapped = `(function() {\n${code}\n})();`;
  await fs.writeFile(outputPath, wrapped);
}
```

### Hash-Based Caching

The build system uses content hashing to avoid unnecessary recompilation:

```typescript
// src/script-hash-cache.ts
export class ScriptHashCache {
  private cache: Map<string, string> = new Map();
  
  async hasChanged(filePath: string): Promise<boolean> {
    const content = await fs.readFile(filePath, 'utf-8');
    const hash = crypto.createHash('sha256')
      .update(content)
      .digest('hex');
    
    const cached = this.cache.get(filePath);
    if (cached === hash) {
      return false;
    }
    
    this.cache.set(filePath, hash);
    return true;
  }
}
```

---

## Device Discovery Implementation

### mDNS/Bonjour Discovery

```typescript
// src/commands/discover.ts
import * as bonjour from 'bonjour-service';

async function discoverDevices(): Promise<DiscoveredDevice[]> {
  const bonjourInstance = bonjour();
  const devices: DiscoveredDevice[] = [];
  
  return new Promise((resolve) => {
    const browser = bonjourInstance.find({
      type: 'shelly',
      protocol: 'tcp'
    });
    
    browser.on('up', (service) => {
      devices.push({
        name: service.name,
        host: service.host,
        addresses: service.addresses || [],
        port: service.port,
        txt: service.txt
      });
    });
    
    setTimeout(() => {
      browser.stop();
      resolve(devices);
    }, 5000);
  });
}
```

---

## Testing

### Unit Tests

Run unit tests:

```bash
npm test
```

Write unit tests for new functionality:

```typescript
// Example test structure
describe('ShellyDevice', () => {
  let device: ShellyDevice;
  
  beforeEach(() => {
    device = new ShellyDevice('192.168.1.100');
  });
  
  it('should get device info', async () => {
    const info = await device.getInfo();
    expect(info).toHaveProperty('id');
    expect(info).toHaveProperty('model');
  });
});
```

### Integration Tests

Test with real devices:

```typescript
// tests/integration/device.test.ts
describe('Device Integration', () => {
  const TEST_DEVICE = process.env.TEST_DEVICE_IP;
  
  it('should deploy and run script', async () => {
    if (!TEST_DEVICE) {
      console.log('Skipping: TEST_DEVICE_IP not set');
      return;
    }
    
    // Test deployment flow
  });
});
```

### Mock Mode

Implement mock mode for testing without devices:

```typescript
// src/utils/mock-device.ts
export class MockDevice {
  async getInfo() {
    return {
      id: "mock-device-123",
      model: "MOCK-PLUS-1PM",
      gen: 2,
      // ... mock data
    };
  }
}
```

---

## Error Handling

### Consistent Error Messages

Use custom error classes:

```typescript
// src/utils/errors.ts
export class ShellyForgeError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ShellyForgeError';
  }
}

export class DeviceConnectionError extends ShellyForgeError {
  constructor(host: string, originalError: Error) {
    super(
      `Failed to connect to device at ${host}`,
      'DEVICE_CONNECTION_ERROR',
      { host, originalError: originalError.message }
    );
  }
}
```

### Error Recovery

Implement retry logic for network operations:

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Retry failed');
}
```

---

## Contributing Guidelines

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use meaningful variable names
- Add JSDoc comments for public APIs

### Commit Messages

Follow conventional commits:

```
feat: add new discovery command
fix: resolve deployment timeout issue
docs: update API reference
refactor: simplify build process
test: add device communication tests
```

### Pull Request Process

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes and test thoroughly
4. Update documentation if needed
5. Submit PR with clear description

### Documentation

Update documentation for:
- New commands
- API changes
- Configuration options
- Breaking changes

---

## Performance Optimization

### Build Performance

Optimize ESBuild configuration:

```typescript
// Parallel builds
const builds = solutions.map(solution => 
  esbuild.build({
    entryPoints: [solution.src],
    // ... config
  })
);

await Promise.all(builds);
```

### Memory Management

Monitor script memory usage:

```typescript
// Track compilation memory
const memBefore = process.memoryUsage();
await compile();
const memAfter = process.memoryUsage();

logger.debug(`Memory delta: ${
  (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024
} MB`);
```

---

## Security Considerations

### Input Validation

Always validate user input:

```typescript
// Validate IP addresses
function isValidIP(ip: string): boolean {
  const pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!pattern.test(ip)) return false;
  
  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}
```

### Secure Communication

Support HTTPS when devices have SSL:

```typescript
const protocol = device.ssl ? 'https' : 'http';
const url = `${protocol}://${device.host}/rpc/method`;
```

---

## Advanced Topics

### Plugin System

Design for future plugin support:

```typescript
// src/plugin-loader.ts
export interface Plugin {
  name: string;
  version: string;
  commands?: CommandTool[];
  hooks?: {
    beforeBuild?: (config: BuildConfig) => void;
    afterDeploy?: (result: DeployResult) => void;
  };
}

export async function loadPlugins(): Promise<Plugin[]> {
  // Plugin loading logic
}
```

### Custom Templates

Allow custom project templates:

```typescript
// src/template-manager.ts
export class TemplateManager {
  async installTemplate(name: string, source: string) {
    // Download and install custom template
  }
  
  async createFromTemplate(template: string, projectName: string) {
    // Scaffold project from template
  }
}
```

---

## Debugging Tips

### Debug Mode

Enable debug logging:

```bash
DEBUG=shelly-forge:* shelly-forge build
```

### Inspect Network Traffic

Use proxy for debugging:

```bash
HTTP_PROXY=http://localhost:8888 shelly-forge deploy
```

### VS Code Launch Configuration

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/dist/shelly-forge.js",
      "args": ["discover"],
      "console": "integratedTerminal",
      "sourceMaps": true
    }
  ]
}
```

---

## Release Process

### Version Bumping

```bash
# Patch release
npm version patch

# Minor release
npm version minor

# Major release
npm version major
```

### Publishing

```bash
# Build and test
npm run build
npm test

# Publish to npm
npm publish
```

### Changelog

Update CHANGELOG.md following Keep a Changelog format.

---

## Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Commander.js Guide](https://github.com/tj/commander.js)
- [ESBuild Documentation](https://esbuild.github.io/)
- [Shelly API Documentation](https://shelly-api-docs.shelly.cloud/)
- [MCP Specification](https://modelcontextprotocol.com/)

---

## Getting Help

- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Discord**: Join the community for real-time help

Happy coding!