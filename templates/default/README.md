# Shelly Forge Project

This is a Shelly Forge project for developing scripts for Shelly smart home devices.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Create a new script:

```bash
npm run create my-script 192.168.1.100
```

This will create a new script in `src/scripts/my-script.ts`

3. Start development:

```bash
SCRIPT_NAME=my-script npm run dev
```

## Project Structure

```
├── src/             # Source code directory
│   ├── scripts/     # Your Shelly scripts
│   └── index.ts     # Main entry file
├── dist/            # Compiled output
└── node_modules/    # Dependencies
```

## Example Script

Here's a basic example of a Shelly script that monitors temperature:

```typescript
import { ShellyBuilder } from "shelly-forge";

export const temperatureMonitor = new ShellyBuilder()
  .hostname("192.168.1.100")
  .script(() => {
    // Subscribe to temperature updates
    Shelly.addEventHandler(async (event) => {
      if (event.component === "temperature") {
        this.log(`Temperature: ${event.data.tC}°C`);
      }
    });
  });
```

## Available Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run deploy` - Deploy to device
- `npm run create <name> <hostname>` - Create a new script

## Documentation

For more detailed information about Shelly Forge, please visit:
[Shelly Forge Documentation](https://github.com/mslavov/shelly-forge)
