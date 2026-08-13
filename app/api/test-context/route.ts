import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    value: "APPROVAL_CONTEXT_TEST"
  });
}

export async function POST(req: NextRequest) {
  return NextResponse.json({
    value: "APPROVAL_CONTEXT_TEST"
  });
}
