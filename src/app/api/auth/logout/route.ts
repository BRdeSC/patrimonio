import { buildSetCookie, destroySession } from "@/lib/session";

export async function POST(request: Request) {
  await destroySession(request);
  const response = Response.json({ ok: true });
  response.headers.set("set-cookie", buildSetCookie(null));
  return response;
}
