import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Outbound-request guard for admin-configured integration URLs.
 *
 * The server fetches whatever URL an admin types in, and the response body is
 * stored in the push log where the admin reads it back. Pointed at
 * http://169.254.169.254/ that would hand over the cloud instance's
 * credentials, and pointed at localhost it would reach this server's own
 * database and admin ports. So only public http(s) destinations are allowed.
 *
 * Set ALLOW_PRIVATE_INTEGRATION_URLS=1 to lift the address check, for testing
 * against a receiver on your own machine. Never set it in production.
 */

function ipv4IsPrivate(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipIsPrivate(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4IsPrivate(ip);
  const v6 = ip.toLowerCase();
  // An IPv4 address wrapped in IPv6 ("::ffff:127.0.0.1", which URL parsing
  // rewrites to "::ffff:7f00:1") is judged by the IPv4 address inside it.
  const dotted = v6.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return ipv4IsPrivate(dotted[1]);
  const hex = v6.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') ||
    v6.startsWith('fc') || v6.startsWith('fd') ||
    v6.startsWith('ff')
  );
}

/** Throws a readable error unless `url` is an http(s) address on the public internet. */
export async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs are allowed (got ${url.protocol.replace(':', '')})`);
  }
  if (process.env.ALLOW_PRIVATE_INTEGRATION_URLS === '1') return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0) throw new Error(`Could not resolve ${host}`);
  if (addresses.some(ipIsPrivate)) {
    throw new Error('Blocked destination: the URL points at a private or internal network address');
  }
}
