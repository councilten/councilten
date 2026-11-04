import { skillText } from "@/lib/skill";
import { origin } from "@/lib/site";

export async function GET() {
  return new Response(await skillText(await origin()), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
