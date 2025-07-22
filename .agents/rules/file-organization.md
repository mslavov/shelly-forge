# File Organization Rules

Consistent file structure enables automatic command loading and maintainability.

## Directory Structure

### CLI Project
```
shelly-forge/
├── src/
│   ├── commands/        # CLI commands (auto-loaded)
│   ├── utils/          # Shared utilities
│   ├── shelly-forge.ts # Main CLI entry
│   └── mcp-server.ts   # MCP server
├── types/              # TypeScript definitions
│   └── ShellyAPI.d.ts  # Device API types
├── templates/          # Init command templates
└── dist/               # Compiled output (ignored)
```

### User Project
```
my-project/
├── src/                # TypeScript scripts
│   └── {solution}/    # Solution folders
│       └── *.ts       # Individual scripts
├── dist/              # Compiled scripts (ignored)
├── .env               # Environment variables
├── solutions.config.json
└── tsconfig.json
```

## Naming Conventions

### Files
- **Commands**: kebab-case matching command (`init.ts`, `deploy.ts`)
- **Classes**: PascalCase (`ShellyDevice.ts`)
- **Utils**: kebab-case (`logger.ts`, `get-cwd.ts`)
- **Types**: PascalCase with `.d.ts`

### Directories
- Always lowercase
- Use hyphens for multi-word
- Plural for collections (`commands/`, `utils/`)

## Command Files

### Required Structure
```typescript
// src/commands/my-command.ts
export const myCommand: CommandTool = { /*...*/ };
export default myCommand.callback;  // Required!
```

### Auto-Loading
- Place in `src/commands/`
- File name = command name
- Automatically available in CLI and MCP

## Import Rules

### Use .js Extension
```typescript
// GOOD
import { logger } from '../utils/logger.js';

// BAD - missing .js
import { logger } from '../utils/logger';
```

### Import Order
```typescript
// 1. Node built-ins
import * as fs from 'fs-extra';
import * as path from 'path';

// 2. External packages
import { Command } from 'commander';

// 3. Internal modules
import { logger } from './utils/logger.js';

// 4. Types
import type { CommandTool } from './types.js';
```

## Special Files

### Entry Points
- `shelly-forge.ts` - CLI entry with shebang
- `mcp-server.ts` - MCP server entry

### Configuration
- `solutions.config.json` - Script mappings
- `.env` - Secrets (git ignored)
- `.env.example` - Template

### Git Ignored
```gitignore
dist/
node_modules/
.env
.shelly-forge/
*.log
```

## Key Rules

1. **Commands in `src/commands/`** - Auto-loaded
2. **Utils in `src/utils/`** - Shared code
3. **Always use .js imports** - ESM requirement
4. **kebab-case for files** - Except classes
5. **Never commit .env** - Use .env.example

## Don'ts

- DON'T put non-commands in commands/
- DON'T use spaces in filenames
- DON'T mix naming conventions
- DON'T forget .js extensions
- DON'T create deep nesting