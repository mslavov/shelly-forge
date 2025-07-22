# System Overview - Shelly Forge

**Last Updated**: 2025-07-22  
**Purpose**: Comprehensive system architecture and functionality overview

---

## Project Summary

Shelly Forge is a TypeScript framework and CLI tool that revolutionizes the development of scripts for Shelly smart home devices. It bridges the gap between modern web development practices and IoT device programming by providing a complete development ecosystem with type safety, real-time debugging, and AI-assisted workflows.

### Key Capabilities

- **TypeScript Development**: Full TypeScript support with complete type definitions for Shelly's API, enabling IntelliSense and compile-time error checking
- **Live Development Server**: Automatic compilation and deployment with hot reloading for rapid iteration
- **AI-Assisted Workflow**: Built-in MCP (Model Context Protocol) server for AI-powered device discovery and automated configuration
- **Real-time Debugging**: Stream device logs and debug information directly to your development console
- **Project Scaffolding**: CLI tools for quick project setup, script creation, and deployment management

---

## Architecture Overview

### Technology Stack

- **Language**: TypeScript 5.0+
- **Runtime**: Node.js 20.0+
- **Build Tool**: ESBuild for fast compilation
- **Package Manager**: npm
- **CLI Framework**: Commander.js
- **Network Discovery**: Bonjour/mDNS service
- **AI Integration**: Model Context Protocol (MCP) SDK
- **WebSocket**: ws library for real-time communication

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Shelly Forge                           │
├─────────────────────────────────────────────────────────────┤
│                       CLI Interface                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Command Parser │  │   MCP Server    │  │  Dev Server    │ │
│  │   (Commander)   │  │  (AI Assistant) │  │  (Live Reload) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                     Core Services                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Script Compiler │  │ Device Manager  │  │  Logger/Debug  │ │
│  │   (ESBuild)     │  │ (Discovery/API) │  │   (Real-time)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Device Communication                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  HTTP/REST API  │  │ WebSocket (WS)  │  │  mDNS/Bonjour  │ │
│  │ (Device Config) │  │  (Live Logs)    │  │  (Discovery)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. CLI Command System

**Location**: `src/shelly-forge.ts`, `src/commands/`

- **Dynamic Command Loading**: Automatically loads all command modules from the commands directory
- **Commander Integration**: Uses Commander.js for robust CLI argument parsing and help generation
- **Schema Validation**: Leverages Zod schemas for input validation
- **Extensible Architecture**: Easy to add new commands by creating modules in the commands directory

### 2. MCP Server (AI Assistant)

**Location**: `src/mcp-server.ts`

- **Model Context Protocol**: Implements MCP for seamless AI integration
- **Tool Registration**: Dynamically registers all CLI commands as MCP tools
- **Error Handling**: Graceful error handling with formatted responses
- **StdIO Transport**: Uses standard input/output for communication with AI clients

### 3. Device Management

**Location**: `src/shelly-device.ts`, `src/commands/discover.ts`

- **mDNS Discovery**: Automatic discovery of Shelly devices on local network using Bonjour
- **Device API Client**: HTTP client for interacting with Shelly device REST APIs
- **Configuration Management**: Handles device-specific configurations and credentials
- **Real-time Communication**: WebSocket support for live device monitoring

### 4. Script Compilation System

**Location**: `src/commands/build.ts`, `src/script-hash-cache.ts`

- **TypeScript to JavaScript**: Compiles TypeScript scripts for Shelly devices
- **Bundle Generation**: Uses ESBuild to create single-file bundles with IIFE wrapper
- **Hash Caching**: Intelligent caching system to avoid unnecessary recompilation
- **Source Maps**: Maintains source maps for debugging compiled scripts

---

## Data Flow

### Script Development Pipeline

1. **Write TypeScript Code**: Developer writes TypeScript code using Shelly API types
2. **Compile to JavaScript**: ESBuild compiles and bundles the TypeScript into a single JavaScript file
3. **Wrap in IIFE**: The compiled code is wrapped in an Immediately Invoked Function Expression
4. **Deploy to Device**: Script is uploaded to the Shelly device via HTTP API
5. **Enable Script**: Script is enabled on the device with optional auto-start on boot
6. **Monitor Execution**: Real-time logs are streamed back via WebSocket connection

### Data Structures

#### Solution Configuration

```typescript
interface SolutionConfig {
  [solutionName: string]: {
    [componentName: string]: {
      src: string;           // Path to TypeScript source file
      device: string;        // Device hostname/IP (supports env vars)
      enableOnBoot: boolean; // Auto-start script on device boot
    }
  }
}
```

#### Device Information

```typescript
interface DeviceInfo {
  id: string;              // Unique device identifier
  model: string;           // Device model (e.g., "SNSW-001X16EU")
  mac: string;             // MAC address
  gen: number;             // Device generation (2 or 3)
  fw_id: string;           // Firmware ID
  ver: string;             // Firmware version
  app: string;             // Application name
  auth_en: boolean;        // Authentication enabled
  auth_domain: string;     // Authentication domain
}
```

#### Script Metadata

```typescript
interface ScriptInfo {
  id: number;              // Script ID on device
  name: string;            // Script name
  enable: boolean;         // Script enabled status
  running: boolean;        // Script running status
}
```

---

## Current Implementation Status

### ✅ Completed Features

- **CLI Framework**: Complete command-line interface with all core commands
- **TypeScript Support**: Full TypeScript compilation and type definitions
- **Device Discovery**: mDNS-based automatic device discovery on local network
- **Script Deployment**: Automated script upload and management
- **MCP Integration**: AI-assisted development through Model Context Protocol
- **Live Development**: Real-time compilation and deployment during development
- **Environment Variables**: Support for environment variables in configuration

### 🔄 In Progress

- **Enhanced Logging**: Improvements to log filtering and presentation
- **Unit Testing**: Framework for testing scripts before deployment
- **Multi-Device Deployment**: Batch operations across multiple devices

### 📋 Planned Features

- **Script Templates**: Pre-built templates for common automation scenarios
- **Visual Studio Code Extension**: Enhanced IDE integration
- **Cloud Backup**: Backup and sync scripts across development environments
- **Script Marketplace**: Community-driven script sharing platform

---

## Algorithm Details

### Script Compilation Process

The compilation system transforms TypeScript into device-compatible JavaScript using:

1. **TypeScript Parsing**: Parses TypeScript files and resolves all imports
2. **Bundle Generation**: ESBuild bundles all dependencies into a single file
3. **IIFE Wrapping**: Wraps the bundle in an IIFE to prevent global scope pollution
4. **Size Optimization**: Minifies code while preserving readability for debugging

### Device Discovery Algorithm

The mDNS discovery process identifies Shelly devices using:

1. **Service Broadcasting**: Listens for `_shelly._tcp` service announcements
2. **Device Filtering**: Filters discovered services by Shelly-specific identifiers
3. **Information Extraction**: Extracts device model, generation, and network details
4. **Connection Validation**: Verifies device accessibility via HTTP API

---

## Performance Considerations

### Current Limitations

- **Script Size**: Shelly devices have limited memory for scripts (typically 64KB)
- **Execution Context**: Scripts run in a sandboxed environment with restricted APIs
- **Network Latency**: Device discovery and deployment depend on network conditions
- **Concurrent Operations**: Limited concurrent script executions on devices

### Optimization Strategies

- **Code Minification**: Aggressive minification to fit within size constraints
- **Lazy Loading**: Load functionality only when needed to reduce memory usage
- **Batch Operations**: Group multiple API calls to reduce network overhead
- **Caching**: Cache device information and compiled scripts to improve performance

---

## Security & Privacy

### Device Security

- **Authentication Support**: Handles device authentication when enabled
- **Secure Communication**: HTTPS support for encrypted device communication
- **Credential Management**: Environment variables for secure credential storage

### Development Security

- **Local Execution**: All operations run locally, no cloud dependencies
- **Code Validation**: TypeScript compilation catches potential security issues
- **Sandboxed Scripts**: Scripts run in isolated device environment

---

## Development Guidelines

### Code Organization

```
shelly-forge/
├── src/                   # Source code
│   ├── commands/         # CLI command implementations
│   ├── utils/            # Utility functions and helpers
│   └── *.ts             # Core modules
├── types/                # TypeScript type definitions
├── templates/            # Project templates
├── docs/                 # Documentation
└── dist/                 # Compiled JavaScript output
```

### Key Principles

- **Type Safety First**: Always use TypeScript types for Shelly APIs
- **Modular Design**: Keep scripts focused on single responsibilities
- **Error Handling**: Implement robust error handling for device communication
- **Performance Aware**: Consider device memory and processing limitations

---

## Deployment & Operations

### Development Setup

```bash
# Install Shelly Forge globally
npm install -g shelly-forge

# Create new project
shelly-forge init my-smart-home
cd my-smart-home

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your device IPs

# Start development server
npm run dev
```

### Production Considerations

- **Device Firmware**: Ensure devices run compatible firmware versions
- **Network Stability**: Reliable local network for device communication
- **Script Persistence**: Scripts persist on devices through reboots
- **Monitoring**: Implement logging for production script monitoring

---

## Future Roadmap

### Phase 1: Enhanced Developer Experience (Q1 2025)

- ✅ TypeScript support and compilation
- ✅ MCP server for AI assistance
- 🔄 Improved debugging and logging tools
- 📋 VS Code extension with IntelliSense

### Phase 2: Advanced Features (Q2 2025)

- 📋 Script testing framework
- 📋 Multi-device orchestration
- 📋 Script performance profiling
- 📋 Advanced scheduling capabilities

### Phase 3: Community & Ecosystem (Q3 2025)

- 📋 Script marketplace/repository
- 📋 Community templates and examples
- 📋 Plugin system for extensions
- 📋 Cloud sync and backup

---

This system overview provides a comprehensive understanding of Shelly Forge's architecture, capabilities, and development status. For specific implementation details, refer to the individual component documentation and API references.
