import { exec } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const SHELLY_IP = process.env.SHELLY_IP;

// Enable debug websocket
exec(
  `curl -X POST -d '{"id":1, "method":"Sys.SetConfig","params":{"config":{"debug":{"websocket":{"enable":true}}}}}' http://${SHELLY_IP}/rpc`,
  (error, stdout, stderr) => {
    if (error) {
      console.error("Error enabling debug:", error);
      return;
    }
    console.log("Debug websocket enabled");
  }
);
