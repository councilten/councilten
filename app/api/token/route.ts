import { getLedger } from "@/lib/token";

export const revalidate = 120;

export async function GET() {
  const l = await getLedger();
  return Response.json(l, { headers: { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=120, stale-while-revalidate=120" } });
}
