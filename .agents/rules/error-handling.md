# Error Handling Rules

Consistent error handling ensures robustness and debugging ease.

## Basic Pattern

### Try-Catch-Log-Rethrow
```typescript
async function operation() {
    try {
        // Do work
        return await riskyOperation();
    } catch (error) {
        logger.error('Operation failed:', error);
        throw error;  // Always rethrow after logging
    }
}
```

### Never Swallow Errors
```typescript
// BAD - Silent failure
try {
    await deploy();
} catch (error) {
    // Nothing here - DON'T DO THIS
}

// GOOD - Log if ignoring
try {
    await optionalCleanup();
} catch (error) {
    logger.debug('Cleanup failed (non-critical):', error);
    // Intentionally continuing
}
```

## Error Types

### Network Errors
```typescript
try {
    await fetch(url);
} catch (error) {
    if (error.code === 'ECONNREFUSED') {
        throw new Error(`Device ${ip} not reachable`);
    }
    if (error.code === 'ETIMEDOUT') {
        throw new Error(`Device ${ip} timeout`);
    }
    throw error;
}
```

### File System Errors
```typescript
try {
    await fs.readFile(path);
} catch (error) {
    if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${path}`);
    }
    if (error.code === 'EACCES') {
        throw new Error(`Permission denied: ${path}`);
    }
    throw error;
}
```

### Validation Errors
```typescript
try {
    const valid = schema.parse(input);
} catch (error) {
    if (error instanceof z.ZodError) {
        const issues = error.errors.map(e => `${e.path}: ${e.message}`);
        throw new Error(`Invalid input: ${issues.join(', ')}`);
    }
    throw error;
}
```

## Command Error Handling

Commands should return error status, not throw to CLI:
```typescript
callback: async (args) => {
    try {
        const result = await operation();
        return { status: "success", data: result };
    } catch (error) {
        logger.error('Command failed:', error);
        return {
            status: "error",
            message: error.message,
            error: error.stack
        };
    }
}
```

## Resource Cleanup

### Use Finally Blocks
```typescript
let resource;
try {
    resource = await acquire();
    await useResource(resource);
} catch (error) {
    logger.error('Failed:', error);
    throw error;
} finally {
    if (resource) {
        await resource.close();
    }
}
```

### Process Exit Handlers
```typescript
process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await cleanup();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught:', error);
    process.exit(1);
});
```

## Error Context

### Include Context
```typescript
// BAD
throw new Error('Failed');

// GOOD
throw new Error(`Failed to deploy ${scriptName} to ${device}: ${error.message}`);
```

### User-Friendly Messages
```typescript
function getUserMessage(error: any): string {
    if (error.code === 'ECONNREFUSED') {
        return 'Cannot connect to device. Is it online?';
    }
    if (error.message.includes('401')) {
        return 'Authentication failed. Check credentials.';
    }
    return `Operation failed: ${error.message}`;
}
```

## Key Rules

1. **Always log before rethrowing**
2. **Never lose stack traces**
3. **Provide context in errors**
4. **Clean up resources**
5. **Transform technical errors for users**

## Don'ts

- DON'T use console.error
- DON'T throw strings
- DON'T catch errors you can't handle
- DON'T forget cleanup
- DON'T expose system paths in errors