import axios from "axios";
import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const SHELLY_IP = process.env.SHELLY_IP;
const SCRIPT_ID = process.env.SCRIPT_ID || "1";
const SCRIPT_NAME = process.env.SCRIPT_NAME || "boiler-thermostat";
const SYMBOLS_IN_CHUNK = 1024;

async function putChunk(code: string, append: boolean = false) {
  try {
    const response = await axios.post(
      `http://${SHELLY_IP}/rpc/Script.PutCode`,
      {
        id: SCRIPT_ID,
        code,
        append,
      },
      { timeout: 2000 }
    );
    console.log("Chunk uploaded:", response.data);
  } catch (error) {
    console.error("Error uploading chunk:", error);
    throw error;
  }
}

async function uploadScript() {
  try {
    const scriptPath = path.join(__dirname, `../dist/${SCRIPT_NAME}.js`);
    const code = readFileSync(scriptPath, "utf-8");

    // Stop script
    console.log("Stopping script");
    await axios.post(`http://${SHELLY_IP}/rpc/Script.Stop`, { id: SCRIPT_ID });

    console.log(`Uploading ${code.length} bytes`);

    // Upload in chunks
    for (let pos = 0; pos < code.length; pos += SYMBOLS_IN_CHUNK) {
      const chunk = code.slice(pos, pos + SYMBOLS_IN_CHUNK);
      await putChunk(chunk, pos > 0);
    }

    console.log("Script uploaded successfully");

    // Restart script
    await axios.post(`http://${SHELLY_IP}/rpc/Script.Start`, { id: SCRIPT_ID });

    console.log("Script restarted");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

uploadScript();
