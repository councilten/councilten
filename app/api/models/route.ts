import { getCatalog } from "@/lib/models";

export const revalidate = 600;

/** Public read endpoint: the ten seats and what they resolve to, with live prices. Open CORS. */
export async function GET() {
  const c = await getCatalog();
  return Response.json(
    {
      updatedAt: c.updatedAt,
      models: { total: c.total, venice: c.venice, blockrun: c.blockrun },
      seats: c.seats.map((s) => ({
        alias: s.alias,
        family: s.label,
        provider: s.model?.provider ?? null,
        model: s.model?.id ?? null,
        usdPerMillionIn: s.model?.input ?? null,
        usdPerMillionOut: s.model?.output ?? null,
        context: s.model?.context ?? null,
      })),
    },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=600, stale-while-revalidate=600" } },
  );
}
