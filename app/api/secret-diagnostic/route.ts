import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const secret = process.env.NHOST_ADMIN_SECRET;
  const isPresent = typeof secret === 'string' && secret.trim().length > 0;
  const isTemplate = isPresent && (secret.includes('{{') || secret.includes('secrets.'));

  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiPresent = typeof geminiKey === 'string' && geminiKey.trim().length > 0;
  const geminiIsTemplate = geminiPresent && (geminiKey.includes('{{') || geminiKey.includes('secrets.'));

  return NextResponse.json({
    NHOST_ADMIN_SECRET_PRESENT: isPresent,
    NHOST_ADMIN_SECRET_IS_TEMPLATE: isTemplate,
    GEMINI_API_KEY_PRESENT: geminiPresent,
    GEMINI_API_KEY_IS_TEMPLATE: geminiIsTemplate,
  });
}
