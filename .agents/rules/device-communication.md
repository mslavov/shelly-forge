# Device Communication Rules

Shelly Forge communicates with devices via HTTP RPC, WebSocket, and mDNS.

## Discovery

### mDNS/Bonjour
```typescript
// Discovers devices on local network
// Looks for "_shelly._tcp" services
// Default scan: 5 seconds

interface DiscoveredDevice {
    name: string;      // "ShellyPlus1PM-A8032AB12345"
    address: string;   // "192.168.1.100"
    port: number;      // 80
    hostname: string;  // "device.local"
}
```

## HTTP Communication

### RPC Endpoint
```
http://{device-ip}/rpc/{method}
```

### Common Methods
```typescript
// Script management
"Script.List"      // List scripts
"Script.Create"    // Create script
"Script.PutCode"   // Update code
"Script.Start"     // Start execution
"Script.Stop"      // Stop execution
"Script.Delete"    // Delete script

// System
"Shelly.GetDeviceInfo"
"Shelly.GetStatus"
```

### Request Format
```typescript
const response = await fetch(`http://${device}/rpc/Script.Create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        name: scriptName,
        enable: true,
        code: scriptContent
    })
});

// Check response
if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const result = await response.json();
if (result.error) {
    throw new Error(`RPC Error: ${result.error.message}`);
}
```

## Authentication

### Basic Auth
```typescript
const auth = Buffer.from(`${user}:${pass}`).toString('base64');
headers['Authorization'] = `Basic ${auth}`;

// Handle 401
if (response.status === 401) {
    throw new Error('Authentication failed');
}
```

## WebSocket Logs

### Debug Endpoint
```typescript
const ws = new WebSocket(`ws://${device}/debug/log`);

ws.on('message', (data) => {
    logger.log(`[${device}] ${data}`);
});

ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
});
```

## Deployment Process

### Steps
1. Check if script exists
2. Delete old version if needed
3. Create new script
4. Upload code (check 64KB limit)
5. Configure script
6. Start if enableOnBoot

### Code Upload
```typescript
const code = await fs.readFile(scriptPath, 'utf-8');

if (code.length > 65536) {
    throw new Error('Script too large');
}

await device.call("Script.PutCode", {
    id: scriptId,
    code: code,
    append: false
});
```

## Error Handling

### Network Errors
```typescript
if (error.code === 'ECONNREFUSED') {
    throw new Error('Device offline');
}
if (error.code === 'ETIMEDOUT') {
    throw new Error('Connection timeout');
}
```

### Device Errors
```typescript
const ERROR_CODES = {
    '-103': 'Invalid parameters',
    '-105': 'Bad parameter value',
    '-108': 'Resource not found',
    '-114': 'Unauthorized'
};
```

## ShellyDevice Class

```typescript
export class ShellyDevice {
    constructor(hostname: string, auth?: Auth) {
        this.baseUrl = `http://${hostname}`;
        this.auth = auth;
    }
    
    async call(method: string, params?: any): Promise<any> {
        const url = `${this.baseUrl}/rpc/${method}`;
        const headers = { 'Content-Type': 'application/json' };
        
        if (this.auth) {
            headers['Authorization'] = this.getAuthHeader();
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(params || {}),
            timeout: 30000
        });
        
        return this.handleResponse(response);
    }
}
```

## Key Rules

1. **HTTP only** - No HTTPS support
2. **30s timeout** - Always set timeouts
3. **Handle auth** - When required
4. **Check errors** - Both HTTP and RPC
5. **Local network** - Devices must be accessible

## Don'ts

- DON'T use HTTPS
- DON'T forget timeouts
- DON'T ignore auth errors
- DON'T hardcode IPs
- DON'T make concurrent calls to same device