import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AirtableError } from "./airtable";
import { COOKIE_NAME, decryptToken, getSecret } from "./session";

/** Reads the Airtable token from the encrypted httpOnly cookie (server only). */
export async function readToken(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return null;
  return decryptToken(value, getSecret());
}

export function errorResponse(err: unknown) {
  if (err instanceof AirtableError && (err.status === 401 || err.status === 403)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  if (err instanceof AirtableError) {
    return NextResponse.json({ error: "airtable_error", status: err.status }, { status: 502 });
  }
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}
