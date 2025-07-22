# Logging Conventions Rules

Use the custom logger utility for consistent output. Never use console.log.

## Logger Usage

### Import and Use
```typescript
import { logger } from '../utils/logger.js';

// Log levels
logger.log('User message');           // General output
logger.info('Operation started');     // Info messages
logger.debug('Detailed info');        // Debug details
logger.error('Error occurred:', err); // Errors with objects
```

### Never Use Console
```typescript
// BAD
console.log('Starting...');
console.error('Failed');

// GOOD
logger.info('Starting...');
logger.error('Failed:', error);
```

## Log Messages

### Include Context
```typescript
// BAD
logger.info('Deploying...');
logger.error('Failed');

// GOOD
logger.info(`Deploying ${scriptName} to ${device}`);
logger.error(`Failed to deploy ${scriptName}:`, error);
```

### Object Logging
```typescript
// BAD - shows [object Object]
logger.debug(`Config: ${config}`);

// GOOD - readable output
logger.debug(`Config: ${JSON.stringify(config, null, 2)}`);
```

## Status Indicators

Use chalk for colored output:
```typescript
import chalk from 'chalk';

logger.log(chalk.green('✓'), 'Success');
logger.log(chalk.red('✗'), 'Failed');
logger.log(chalk.yellow('⚠'), 'Warning');
logger.log(chalk.blue('ℹ'), 'Info');
```

## Command Logging

### Lifecycle Pattern
```typescript
export const myCommand: CommandTool = {
    callback: async (args) => {
        logger.info('Starting my-command');
        
        try {
            // Work here
            logger.info('Operation completed');
            return { status: "success" };
        } catch (error) {
            logger.error('Operation failed:', error);
            throw error;
        }
    }
};
```

### Progress Updates
```typescript
const total = items.length;
for (let i = 0; i < items.length; i++) {
    logger.info(`Processing ${i + 1}/${total}: ${items[i].name}`);
    await process(items[i]);
}
```

## File Logging

- Logs auto-saved to `.shelly-forge/logs/console.log`
- Directory created if missing
- Timestamps added automatically

## User Scripts

In device scripts, use `print()`:
```typescript
// Only in scripts that run on Shelly devices
print("Temperature:", temp);
print("Device started");

// NOT in CLI code - use logger there
```

## Key Rules

1. **Always use logger in CLI code**
2. **Use print() only in device scripts**
3. **Include context in messages**
4. **JSON.stringify objects**
5. **Use chalk for status**

## Don'ts

- DON'T use console.log/error
- DON'T log passwords or secrets
- DON'T log in tight loops
- DON'T create custom log files