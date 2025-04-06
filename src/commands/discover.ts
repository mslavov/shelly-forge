import { z } from "zod";
import { Bonjour } from "bonjour-service";
import { logger } from '../utils/logger.js';

// Define expected Shelly service type (Needs verification - common patterns include _http._tcp, _shelly._tcp)
const SHELLY_SERVICE_TYPE = "http"; // Placeholder - VERIFY THIS!

interface DiscoveredDevice {
    name: string;
    address: string;
    port: number;
    model?: string; // Attempt to get model from TXT records if available
    id?: string; // Attempt to get ID from TXT records if available
}

export async function findShellyDevicesOnNetwork(
    scanDurationSeconds: number = 5,
): Promise<DiscoveredDevice[]> {
    return new Promise((resolve) => {
        logger.log(
            `MCP Discovery: Starting scan for Shelly devices (${scanDurationSeconds}s)...`,
        );
        const bonjour = new Bonjour();
        const discovered: DiscoveredDevice[] = [];
        const browser = bonjour.find(
            { type: SHELLY_SERVICE_TYPE },
            (service) => {
                // Heuristic check if it's likely a Shelly device based on name/TXT records
                // Shelly names often contain 'shelly' and the model/ID
                if (service.name.toLowerCase().includes("shelly")) {
                    logger.log(
                        `MCP Discovery: Found potential Shelly: ${service.name} at ${service.addresses[0]
                        }:${service.port}`,
                    );
                    const device: DiscoveredDevice = {
                        name: service.name,
                        address: service.addresses[0], // Prefer IPv4
                        port: service.port,
                        // TODO: Parse service.txt records for model, id, etc.
                        model: service.txt?.model || "unknown",
                        id: service.txt?.id || service.txt?.mac || "unknown",
                    };
                    // Avoid duplicates based on address or unique ID from TXT
                    if (
                        !discovered.some((d) =>
                            d.address === device.address ||
                            (d.id !== "unknown" && d.id === device.id)
                        )
                    ) {
                        discovered.push(device);
                    }
                }
            },
        );

        // Stop browsing after the specified duration
        setTimeout(() => {
            browser.stop();
            bonjour.destroy();
            logger.log(
                `MCP Discovery: Scan finished. Found ${discovered.length} devices.`,
            );
            resolve(discovered);
        }, scanDurationSeconds * 1000);
    });
}


export const name = "discover";

export const inputSchema = z.object({
    scanDurationSeconds: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .default(5)
        .describe("The number of seconds to scan for Shelly devices."),
});

export async function callback(
    input: z.infer<typeof inputSchema>,
): Promise<string> {
    /**
     * Scans the local network for Shelly devices using mDNS/Bonjour.
     */
    try {
        const devices = await findShellyDevicesOnNetwork(
            input.scanDurationSeconds,
        );
        if (devices.length === 0) {
            return "No Shelly devices found on the network during the scan.";
        }
        // Format output as JSON string for clarity
        return JSON.stringify(devices, null, 2);
    } catch (error: any) {
        logger.error(`MCP Error: discovering devices`, error);
        return `Failed to perform discovery. Error: ${error.message}`;
    }
}

/**
 * Default export function for the discover command
 * Scans the local network for Shelly devices using mDNS/Bonjour
 */
export default async function discover(scanDurationSeconds: number = 5): Promise<string> {
    return await callback({ scanDurationSeconds });
} 