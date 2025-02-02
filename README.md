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
npm run create my-script '${DEVICE_HOSTNAME}' solutionA
```

3. Start development:

```bash
npm run dev
```

## Concepts

-   **Solutions**: A solution is a collection of scripts that are deployed to a specific device(s).
-   **Scripts**: A script is a piece of code that is deployed to a specific device.
-   **Devices**: A device is a Shelly smart home device.

## Project Structure

```
my-project/
├── build-cache/      # Build cache directory
├── dist/             # Compiled output
├── node_modules/     # Dependencies
├── src/              # Source code directory
├── .editorconfig     # Editor configuration
├── .gitignore        # Git ignore rules
├── .env              # Environment variables
├── solutions.config.json # Solution configuration
├── package-lock.json # Lock file for dependencies
├── package.json      # Project configuration
└── tsconfig.json     # TypeScript configuration
```

## Solution Configuration

Solutions are defined in a JSON configuration file that maps scripts to specific devices. Each solution can have multiple components, and each component specifies:

-   `src`: Path to the script source file
-   `device`: Target device hostname/IP (can use environment variables)
-   `enableOnBoot`: Whether the script should run on device boot

Example `solutions.config.json`:

```json
{
    "boiler": {
        "mqtt": {
            "src": "src/boiler/mqtt.ts",
            "device": "${BOILER_HOSTNAME}",
            "enableOnBoot": true
        },
        "thermostat": {
            "src": "src/boiler/thermostat.ts",
            "device": "${BOILER_HOSTNAME}",
            "enableOnBoot": true
        }
    }
}
```

Device hostnames/IPs can be provided through environment variables using the `${VARIABLE_NAME}` syntax. This allows you to keep device-specific configuration separate from your code and easily switch between different environments.

For example, you could set the boiler hostname in your `.env` file:

```
BOILER_HOSTNAME=192.168.1.100
```

## Writing Scripts

### Basic Script

The script is wrapped into IIFE (Immediately Invoked Function Expression) and deployed to the device. For example, to subscribe to temperature updates, you can use the following code:

```typescript
// Subscribe to temperature updates
Shelly.addEventHandler(async (event) => {
    if (event.component === 'temperature') {
        print('Temperature: ' + event.data.tC + '°C');
    }
});
```

### Reusable code

Scripts are bundled into a single file, which makes it possible to reuse code between scripts.
For example we can have a helloWorld.ts script, which uses a custom print function.
File `src/solutionA/printer.ts`

```typescript
export function printMessage(message: string) {
    print('Hello World from printer: ' + message);
}
```

File `src/solutionA/helloWorld.ts`

```typescript
import { printMessage } from './printer';

printMessage('Hello World from test');
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

### Device APIs

Shelly Forge provides TypeScript definitions for all device APIs. Please refer to the [Shelly API documentation](https://shelly-api-docs.shelly.cloud/) for more details.

```typescript
// Component Control
Shelly.call('Switch.Set', { id: 0, on: true });
```

## TODO

-   [ ] Add support for unit tests
-   [ ] Add Shelly device emulators
-   [ ] Improve the logs function to show only the logs and not the whole event object

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

-   [GitHub Issues](https://github.com/mslavov/shelly-forge/issues)
