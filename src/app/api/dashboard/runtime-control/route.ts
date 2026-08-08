import {
  GET as platformGet,
  POST as platformPost,
  PUT as platformPut,
} from "@/app/api/platform-admin/runtime-control/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return platformGet(request);
}

export async function PUT(request: Request) {
  return platformPut(request);
}

export async function POST(request: Request) {
  return platformPost(request);
}
