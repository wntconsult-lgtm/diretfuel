import { APP_VERSION } from "@/lib/directfuel-version";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ applicationVersion: APP_VERSION }, {
    headers: { "cache-control": "no-store" },
  });
}
