# Environment Variables Rules

Shelly Forge uses environment variables for configuration and build-time injection.

## Variable Types

### CLI Variables
```bash
# Working directory
CURRENT_WORKING_DIRECTORY=/path/to/project

# Device authentication
SHELLY_AUTH_USER=admin
SHELLY_AUTH_PASS=password

# Device hostnames
SHELLY_KITCHEN=192.168.1.100
SHELLY_LIVING_ROOM=device.local
```

### Build-Time Variables
```bash
# Must use SHELLY_PUBLIC_ prefix
SHELLY_PUBLIC_API_KEY=your-key
SHELLY_PUBLIC_WEBHOOK_URL=https://example.com
SHELLY_PUBLIC_THRESHOLD=25.5
```

## .env Files

### Loading
```typescript
// Automatic in SolutionsConfig
import * as dotenv from 'dotenv';
dotenv.config();
```

### Format
```bash
# .env
SHELLY_KITCHEN=192.168.1.100
SHELLY_AUTH_USER=admin
SHELLY_AUTH_PASS=secret

# Build variables
SHELLY_PUBLIC_API_KEY=abc123
SHELLY_PUBLIC_LOG_LEVEL=debug
```

### .env.example
```bash
# Copy to .env and fill values
SHELLY_DEVICE_1=
SHELLY_DEVICE_2=

# Optional auth
SHELLY_AUTH_USER=
SHELLY_AUTH_PASS=

# Script config
SHELLY_PUBLIC_API_KEY=
```

## Configuration Usage

### Variable Resolution
```json
// solutions.config.json
{
  "kitchen": {
    "lights": {
      "src": "src/kitchen/lights.ts",
      "device": "${SHELLY_KITCHEN}",
      "enableOnBoot": true
    }
  }
}
```

### Resolution Rules
- `${VAR}` syntax only
- Case-sensitive
- No nested expansion
- Missing vars throw errors

## Build-Time Injection

### SHELLY_PUBLIC_ Prefix
```typescript
// In script
const API_KEY = process.env.SHELLY_PUBLIC_API_KEY;
const THRESHOLD = process.env.SHELLY_PUBLIC_THRESHOLD || "20";

// After build
const API_KEY = "abc123";
const THRESHOLD = "25.5" || "20";
```

### ESBuild Config
```typescript
const defines = {};
for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('SHELLY_PUBLIC_')) {
        defines[`process.env.${key}`] = JSON.stringify(value);
    }
}
```

## Security

### Never Commit .env
```gitignore
.env
.env.*
!.env.example
```

### No Secrets in SHELLY_PUBLIC_
```bash
# GOOD - public config
SHELLY_PUBLIC_API_ENDPOINT=https://api.example.com
SHELLY_PUBLIC_UPDATE_INTERVAL=5000

# BAD - secrets exposed in scripts!
SHELLY_PUBLIC_PASSWORD=secret     # DON'T!
SHELLY_PUBLIC_API_SECRET=key      # DON'T!
```

## Best Practices

### Naming
```bash
# Devices - uppercase
SHELLY_KITCHEN_LIGHTS=192.168.1.100
SHELLY_BEDROOM_SENSOR=device.local

# Public - descriptive
SHELLY_PUBLIC_TEMP_UNIT=celsius
SHELLY_PUBLIC_DEBUG_MODE=false
```

### Default Values
```typescript
// Always provide fallbacks
const interval = parseInt(process.env.SHELLY_PUBLIC_INTERVAL || "5000");
const debug = process.env.SHELLY_PUBLIC_DEBUG === "true";
```

## Example Setup

```bash
# .env
# Devices
SHELLY_KITCHEN=192.168.1.100
SHELLY_BEDROOM=192.168.1.101

# Auth (if needed)
SHELLY_AUTH_USER=admin
SHELLY_AUTH_PASS=myPassword

# Public config (injected)
SHELLY_PUBLIC_API_URL=https://api.weather.com
SHELLY_PUBLIC_UPDATE_MS=300000
```

## Key Rules

1. **Use .env for secrets**
2. **SHELLY_PUBLIC_ for injection**
3. **Never commit .env**
4. **Always provide defaults**
5. **Use ${VAR} in config**

## Don'ts

- DON'T put secrets in SHELLY_PUBLIC_
- DON'T commit .env files
- DON'T use quotes in .env unless needed
- DON'T forget .env.example
- DON'T use spaces around = in .env