import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function skillText(origin: string) {
  const raw = await readFile(join(process.cwd(), "kit", "SKILL.md"), "utf8");
  return raw.replaceAll("https://councilten.com", origin);
}
