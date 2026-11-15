import { NextResponse } from "next/server";
import { createClient } from "@/lib/airtable";
import { errorResponse, readToken } from "@/lib/auth";
import { parsePatch } from "@/lib/patch";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const token = await readToken();
    if (!token) return NextResponse.json({ error: "no_token" }, { status: 401 });

    const { id } = await ctx.params;
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: "bad_id" }, { status: 400 });
    }
    const patch = parsePatch(await req.json().catch(() => null));
    if (!patch) return NextResponse.json({ error: "bad_patch" }, { status: 400 });

    const job = await createClient(token).updateJob(id, patch);
    return NextResponse.json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
