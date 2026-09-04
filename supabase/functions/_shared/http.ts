export const corsHeaders = (request: Request) => {
  const allowedOrigin = Deno.env.get('PUBLIC_PORTAL_ORIGIN') ?? 'http://localhost:5173';
  const requestOrigin = request.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-bridge-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
};

export const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });

export const handleOptions = (request: Request) =>
  request.method === 'OPTIONS'
    ? new Response(null, { status: 204, headers: corsHeaders(request) })
    : null;

export const safeError = (request: Request, status: number, message: string) =>
  json(request, { message }, status);
