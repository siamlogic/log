import { NextResponse } from 'next/server';
import { getCurrentSessionUser } from '@/lib/auth-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const res = NextResponse.json({ user });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res;
}
