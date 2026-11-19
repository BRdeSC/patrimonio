// Helper para chamar os route handlers diretamente (sem subir o Next).
type Handler<TParams> = (
  request: Request,
  ctx: { params: Promise<TParams> },
) => Promise<Response>;

export interface CallOpts {
  body?: unknown;
  cookie?: string;
  ip?: string;
  // Multipart: o Request define o content-type (boundary) sozinho.
  formData?: FormData;
}

// TParams é inferido do handler (rotas dinâmicas) ou do 5º argumento (params).
export function call<TParams extends object = object>(
  handler: Handler<TParams>,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: CallOpts = {},
  params: TParams = {} as TParams,
): Promise<Response> {
  const headers = new Headers();
  // Multipart: o Request define o content-type (boundary) sozinho — não setar.
  if (opts.formData === undefined && opts.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (opts.cookie) headers.set("cookie", `patrimonio_session=${opts.cookie}`);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  const request = new Request(`http://test.local${path}`, {
    method,
    headers,
    body:
      opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const ctx = { params: Promise.resolve(params) };
  return handler(request, ctx);
}

export function cookieToken(res: Response): string | undefined {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return undefined;
  const match = /patrimonio_session=([^;]+)/.exec(setCookie);
  return match ? decodeURIComponent(match[1]) : undefined;
}
