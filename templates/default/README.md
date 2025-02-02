# Shelly Forge Project

This is a Shelly Forge project for developing scripts for Shelly smart home devices.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Create a new script:

```bash
npm run create my-script '${DEVICE_HOSTNAME}' solutionA
```

This will create a new script in `src/solutionA/my-script.ts`

3. Start development:

```bash
npm run dev
```

## Project Structure

```
├── src/             # Source code directory
│   ├── solutionA/   # Your Shelly scripts for the solution
│   └── index.ts     # Main entry file
├── dist/            # Compiled output
└── node_modules/    # Dependencies
```

## Example Script

Here's a basic example of a Shelly script that monitors temperature:

```typescript
// Subscribe to temperature updates
Shelly.addEventHandler(async (event) => {
  if (event.component === "temperature") {
    print("Temperature: " + event.data.tC + "°C");
  }
});
```

## Available Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run deploy` - Deploy to device
- `npm run create <name> <hostname> <solution>` - Create a new script

## Documentation

For more detailed information about Shelly Forge, please visit:
[Shelly Forge Documentation](https://github.com/mslavov/shelly-forge)
