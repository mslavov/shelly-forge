export function parseDeviceUrl(host: string, pathname = ''): URL {
    const url = new URL(`http://${host}${pathname}`);
    if (!url.hostname || /[\s/@?#\\]/.test(host)) throw new Error('Invalid host');
    return url;
}

export function deviceKey(host: string): string {
    return parseDeviceUrl(host).host;
}
