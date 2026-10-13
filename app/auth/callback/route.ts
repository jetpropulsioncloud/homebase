import { NextRequest, NextResponse } from 'next/server';
// Supabase's browser client picks up the access token from the magic link URL fragment.
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/', request.url));
}
