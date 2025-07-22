# Command Patterns Rules

All Shelly Forge CLI commands follow a consistent pattern for maintainability and MCP compatibility.

## Command Structure

### Required Export Pattern
```typescript
export const commandName: CommandTool = {
    name: string,                                    // kebab-case
    description: string,                             // starts with verb
    inputSchema: { [key: string]: z.ZodTypeAny },  // Zod validation
    callback: (args: any) => Promise<any>           // async function
};

export default commandName.callback;  // Required for CLI
```

### Input Schema
```typescript
inputSchema: {
    name: z.string().describe('Project name'),
    timeout: z.number().optional().default(5000).describe('Timeout in ms')
}
```

### Callback Pattern
```typescript
callback: async (args) => {
    logger.info('Starting operation...');
    try {
        const result = await performOperation(args);
        return {
            status: "success",
            message: "Operation completed",
            data: result
        };
    } catch (error) {
        logger.error('Operation failed:', error);
        throw error;  // Re-throw after logging
    }
}
```

## File Organization

- Location: `src/commands/*.ts`
- File name matches command name: `deploy.ts` → `"deploy"`
- Auto-loaded by CLI and MCP server

## Example Command

```typescript
// src/commands/deploy.ts
import { z } from 'zod';
import { CommandTool } from './types';
import { logger } from '../utils/logger';

export const deployCommand: CommandTool = {
    name: "deploy",
    description: "Deploy scripts to Shelly devices",
    inputSchema: {
        scriptName: z.string().optional().describe('Script to deploy')
    },
    callback: async (args) => {
        logger.info('Starting deployment...');
        try {
            const result = await deployScripts(args.scriptName);
            return {
                status: "success",
                deployed: result.count
            };
        } catch (error) {
            logger.error('Deployment failed:', error);
            throw error;
        }
    }
};

export default deployCommand.callback;
```

## Key Rules

1. **Always use logger** - Never console.log
2. **Always async/await** - No callbacks or raw promises
3. **Always validate** - Use Zod schemas
4. **Always handle errors** - Log then re-throw
5. **Always return result** - Include status field

## Don'ts

- DON'T use process.exit()
- DON'T swallow errors
- DON'T use synchronous operations
- DON'T forget default export