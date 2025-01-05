import { ShellyBuilder } from "shelly-forge";

export const testPump = new ShellyBuilder()
  .hostname("192.168.1.106")
  .script(() => {
    print("Hello World");
  });
