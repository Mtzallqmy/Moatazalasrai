import {
  GET as platformGet,
  POST as platformPost,
} from "@/app/api/platform-admin/whatsapp-runtime/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return platformGet(request);
}

export async function POST(request: Request) {
  return platformPost(request);
}
