# Shelly Forge

[![npm version](https://badge.fury.io/js/shelly-forge.svg)](https://badge.fury.io/js/shelly-forge)

Shelly Forge is a TypeScript framework and CLI tool for developing, testing, and deploying scripts to Shelly smart home devices. It provides a modern development experience with type safety, live reloading, and real-time debugging capabilities.

## Overview

Shelly Forge simplifies the development of Shelly Scripts by providing:

-   Full TypeScript support with type definitions for Shelly's API
-   CLI tools for project scaffolding and deployment
-   Live development server with automatic compilation
-   Real-time device logs and debugging
-   Project templates and examples

## Quick Start

1. Create a new project:

```bash
npx shelly-forge init my-project
cd my-project
npm install
```

2. Create your first script:

```bash
npm run create my-script 192.168.1.100
```

3. Start development:

```bash
SCRIPT_NAME=my-script npm run dev
```

## Project Structure

```
my-project/
├── build-cache/      # Build cache directory
├── dist/             # Compiled output
├── node_modules/     # Dependencies
├── src/              # Source code directory
├── .editorconfig     # Editor configuration
├── .gitignore        # Git ignore rules
├── package-lock.json # Lock file for dependencies
├── package.json      # Project configuration
└── tsconfig.json     # TypeScript configuration
```

## Writing Scripts

### Basic Script

The script is defined as a function that returns a ShellyScript instance. The builder is used to configure the script. For example, to subscribe to temperature updates, you can use the following code:

```typescript
import { ShellyBuilder } from 'shelly-forge';

export const temperatureMonitor = new ShellyBuilder().hostname('192.168.1.100').script(() => {
    // Subscribe to temperature updates
    Shelly.addEventHandler(async (event) => {
        if (event.component === 'temperature') {
            this.log(`Temperature: ${event.data.tC}°C`);
        }
    });
});
```

Then the script needs to be exported from the main entry file:

```typescript
export * from './scripts/temperatureMonitor';
```

## CLI Commands

### Project Management

-   `shelly-forge init [name]` - Create new project
-   `shelly-forge deploy` - Deploy scripts to device
-   `shelly-forge debug <on|off>` - Toggle debug mode
-   `shelly-forge create <name> <hostname>` - Create a new script

### Development

-   `npm run dev` - Start development server
-   `npm run build` - Build for production
-   `npm run deploy` - Deploy to device

## API Reference

### ShellyBuilder Class

```typescript
class ShellyBuilder {
    // Configure the target device's hostname/IP
    hostname(ip: string): ShellyBuilder;

    // Configure if script should run on device boot
    enableOnBoot(enable: boolean): ShellyBuilder;

    // Create a new ShellyScript instance with the provided code
    script(code: () => void): ShellyScript;
}
```

### ShellyScript Class

```typescript
class ShellyScript {
    constructor(ip: string, code: () => void, enableOnBoot: boolean);

    // Enable/disable debug websocket
    setDebug(enable: boolean): Promise<void>;

    // Deploy script to device
    deploy(name: string): Promise<boolean>;
}
```

### Device APIs

Shelly Forge provides TypeScript definitions for all device APIs. Please refer to the [Shelly API documentation](https://shelly-api-docs.shelly.cloud/) for more details.

```typescript
// Component Control
Shelly.call('Switch.Set', { id: 0, on: true });
```

## TODO

-   [ ] Add unit tests
-   [ ] Add Shelly device emulators
-   [ ] Add device abstraction, i.e. decouple the script logic from the device

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

-   [GitHub Issues](https://github.com/mslavov/shelly-forge/issues)
