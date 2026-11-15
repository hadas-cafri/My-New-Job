import { NextResponse } from "next/server";
import { createClient } from "@/lib/airtable";
import { errorResponse, readToken } from "@/lib/auth";
import { COOKIE_NAME, cookieOptions, encryptToken, getSecret, maskToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Connection status. Returns only a masked token, never the real one. */
export async function GET() {
  try {
    const token = await readToken();
    return NextResponse.json(
      token ? { connected: true, masked: maskToken(token) } : { connected: false },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/** Validates the token against Airtable, then stores it encrypted in an httpOnly cookie. */
export async function POST(req: Request) {
  let token = "";
  try {
    const body = (await req.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    /* fall through to validation error */
  }
  if (token.length < 10 || /\s/.test(token)) {
    return NextResponse.json({ error: "bad_format" }, { status: 400 });
  }

  try {
    await createClient(token).ping();
    const res = NextResponse.json({ connected: true, masked: maskToken(token) });
    res.cookies.set(COOKIE_NAME, encryptToken(token, getSecret()), cookieOptions());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

/** Disconnect: clears the cookie. */
export async function DELETE() {
  const res = NextResponse.json({ connected: false });
  res.cookies.set(COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
