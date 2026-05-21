/**
 * Parsed server address with host and port.
 */
export interface ServerAddress {
  host: string;
  port: number;
}

/**
 * Authentication options for Nacos server connections.
 */
export interface AuthOptions {
  accessKey?: string;
  secretKey?: string;
  username?: string;
  password?: string;
}

/**
 * Parse a server address string into host and port.
 * Supports formats: "host:port", "host", "http://host:port", "https://host:port"
 */
export function parseServerAddress(addr: string, defaultPort = 8848): ServerAddress {
  let cleaned = addr.trim();

  if (cleaned.startsWith('http://')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('https://')) {
    cleaned = cleaned.slice(8);
  }

  // Remove trailing path if any
  const slashIndex = cleaned.indexOf('/');
  if (slashIndex !== -1) {
    cleaned = cleaned.slice(0, slashIndex);
  }

  const colonIndex = cleaned.lastIndexOf(':');
  if (colonIndex !== -1) {
    const host = cleaned.slice(0, colonIndex);
    const port = parseInt(cleaned.slice(colonIndex + 1), 10);
    if (!isNaN(port)) {
      return { host, port };
    }
  }

  return { host: cleaned, port: defaultPort };
}
