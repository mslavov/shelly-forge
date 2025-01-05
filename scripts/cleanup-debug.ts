import { exec } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const SHELLY_IP = process.env.SHELLY_IP;

// Disable debug websocket
exec(
  `curl -X POST -d '{"id":1, "method":"Sys.SetConfig","params":{"config":{"debug":{"websocket":{"enable":false}}}}}' http://${SHELLY_IP}/rpc`,
  (error, stdout, stderr) => {
    if (error) {
      console.error("Error disabling debug:", error);
      process.exit(1);
    }
    console.log("Debug websocket disabled");
    process.exit(0);
  }
);
