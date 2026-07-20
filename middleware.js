import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.json(
    {
      ok: false,
      error: "Service unavailable.",
    },
    { status: 503 },
  );
}

export const config = {
  matcher: ["/:path*"],
};
