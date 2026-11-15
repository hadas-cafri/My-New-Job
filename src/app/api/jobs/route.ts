import { NextResponse } from "next/server";
import { createClient } from "@/lib/airtable";
import { errorResponse, readToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = await readToken();
    if (!token) return NextResponse.json({ error: "no_token" }, { status: 401 });
    const jobs = await createClient(token).listJobs();
    return NextResponse.json({ jobs, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
