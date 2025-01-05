import fs from "fs";
import path from "path";

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: npm run setup <ip-address> <script-name> [script-id]");
  process.exit(1);
}

const [ip, scriptName] = args;
const scriptId = args[2] || "0";

// Create/update .env file
const envContent = `SHELLY_IP=${ip}
SCRIPT_NAME=${scriptName}
SCRIPT_ID=${scriptId}
`;

fs.writeFileSync(".env", envContent);
console.log(".env file created/updated");

// Create script file if it doesn't exist
const scriptContent = `// ${scriptName}.ts
print("hello world");
`;

const scriptPath = path.join("src", `${scriptName}.ts`);
if (!fs.existsSync("src")) {
  fs.mkdirSync("src");
}

if (!fs.existsSync(scriptPath)) {
  fs.writeFileSync(scriptPath, scriptContent);
  console.log(`Created ${scriptPath}`);
} else {
  console.log(`${scriptPath} already exists, skipping creation`);
}

console.log("\nSetup complete! You can now run:");
console.log("npm run dev");
