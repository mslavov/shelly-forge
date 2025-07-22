# Security Patterns Rules

Security focuses on protecting credentials, validating inputs, and safe device communication.

## Authentication

### Credential Storage
```typescript
// GOOD - from environment
const auth = {
    username: process.env.SHELLY_AUTH_USER,
    password: process.env.SHELLY_AUTH_PASS
};

// BAD - hardcoded
const auth = {
    username: "admin",
    password: "password123"  // NEVER!
};
```

### Basic Auth
```typescript
const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
headers['Authorization'] = `Basic ${credentials}`;

// Validate before use
if (device.requiresAuth && !auth.username) {
    throw new Error('Auth required but not provided');
}
```

## Input Validation

### Use Zod Schemas
```typescript
const ipSchema = z.string().regex(
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/,
    'Invalid IP address'
);

const scriptNameSchema = z.string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid characters')
    .max(50, 'Name too long');
```

### Path Validation
```typescript
function validatePath(scriptPath: string): string {
    const resolved = path.resolve(process.cwd(), scriptPath);
    
    // Prevent directory traversal
    if (!resolved.startsWith(process.cwd())) {
        throw new Error('Invalid path: outside project');
    }
    
    return resolved;
}
```

## Network Security

### Local Network Only
```typescript
function isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    return (
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
    );
}
```

### HTTP Only
```typescript
// Devices don't support HTTPS
if (url.startsWith('https://')) {
    throw new Error('Use HTTP for devices');
}

// Always set timeouts
const response = await fetch(url, {
    timeout: 30000
});
```

## Code Security

### No Dynamic Code
```typescript
// NEVER
eval(userInput);              // Code injection!
new Function(userInput);      // Code injection!

// Use predefined operations
const ops = {
    'add': (a, b) => a + b,
    'sub': (a, b) => a - b
};
const result = ops[operation]?.(a, b);
```

### Size Limits
```typescript
const MAX_SCRIPT_SIZE = 65536;

if (script.length > MAX_SCRIPT_SIZE) {
    throw new Error(`Script too large: ${script.length} bytes`);
}
```

## Environment Security

### Git Security
```gitignore
# .gitignore
.env
.env.*
!.env.example
*credentials*
*password*
```

### Log Security
```typescript
// BAD - logs password
logger.debug(`Auth: ${JSON.stringify(auth)}`);

// GOOD - sanitized
logger.debug(`Auth: ${auth.username ? 'enabled' : 'disabled'}`);
```

### Error Messages
```typescript
// BAD - exposes paths
throw new Error(`Failed: /home/user/project/secret.key`);

// GOOD - generic
throw new Error('Failed to read configuration');
```

## Secure Implementation

```typescript
export class SecureDevice {
    constructor(hostname: string) {
        // Validate hostname
        if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
            throw new Error('Invalid hostname');
        }
        
        this.hostname = hostname;
        
        // Load auth from env only
        if (process.env.SHELLY_AUTH_USER) {
            this.auth = {
                username: process.env.SHELLY_AUTH_USER,
                password: process.env.SHELLY_AUTH_PASS || ''
            };
        }
    }
    
    async call(method: string, params?: any): Promise<any> {
        // Validate method name
        if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) {
            throw new Error('Invalid method');
        }
        
        // Timeout protection
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 30000);
        
        // Make request...
    }
}
```

## Key Rules

1. **Never hardcode credentials**
2. **Always validate inputs**
3. **Use Zod for schemas**
4. **HTTP only for devices**
5. **Set request timeouts**

## Don'ts

- DON'T log passwords
- DON'T use eval()
- DON'T trust user input
- DON'T expose file paths
- DON'T skip validation
- DON'T use HTTPS with devices