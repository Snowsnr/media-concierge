export const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const randomToken = (bytes = 32) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
};

export const bridgeAuthorized = async (request: Request) => {
  const supplied = request.headers.get('x-bridge-token') ?? '';
  const expected = Deno.env.get('HOMELAB_BRIDGE_TOKEN') ?? '';
  if (!supplied || !expected) return false;
  return (await sha256(supplied)) === (await sha256(expected));
};
