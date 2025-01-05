# Shelly Script Examples

This project provides a modern development environment for creating and deploying Shelly Scripts to your Shelly devices. It includes TypeScript support, live reloading, and real-time device logs to make development faster and more reliable.

## Features

- 🚀 TypeScript support for better development experience
- 📝 Automatic compilation and deployment to your device
- 🔄 Live reload when you save changes
- 📊 Real-time device logs in your terminal
- 🛠️ Simple setup process with CLI tools

## About Shelly Scripts

Shelly Scripts allow you to create custom automation logic directly on your Shelly device. Initial support for Shelly Script comes with firmware version 0.9 (September 2021) for Gen2 Shellies based on ESP32.

## Development Setup

### Prerequisites

- Node.js (v16 or higher)
- npm
- A Shelly device with firmware version 0.9 or higher

### Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up your development environment:

```bash
npm run setup <device-ip> <script-name> [script-id]
```

For example:

```bash
npm run setup 192.168.1.100 my-script
```

This will:

- Create/update the `.env` file with your device settings
- Create a new script file in the `src` directory

3. Start development:

```bash
npm run dev
```

This command will:

- Set up debug logging on your device
- Watch for changes in your TypeScript files
- Automatically compile and upload changes to your device
- Show real-time logs from your device

The development server will automatically:

- Compile TypeScript files on change
- Upload the compiled JavaScript to your Shelly device
- Stream debug logs from your device

To stop development, press `Ctrl+C`. This will automatically clean up the debug configuration on your device.

# Changelog

[Previous changelog entries...]
