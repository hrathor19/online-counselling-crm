import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * The course list every lead-entry screen offers.
 *
 * Served from the options a Super Admin maintains under Manage Dropdowns →
 * Courses, not from the LMS course-group feed this used to proxy. The LMS
 * list is the whole national catalogue — hundreds of courses, most of which
 * this team does not sell — so a counsellor picked from a list that was
 * mostly noise, and a CSV could introduce a course nobody offers.
 *
 * Every caller keeps working unchanged because the response shape is the
 * same `{ id, name }[]`: Add Lead, CSV validation, the receipt dialog and
 * the three pickers on the lead profile all read this one endpoint, so they
 * cannot drift onto different lists.
 *
 * Note for anyone wiring up new ingestion: the external API at
 * /api/v1/leads still resolves `course` as an LMS course_group_id, because
 * that is its published contract with partner systems. It is the one path
 * that does not read this list.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const courses = await prisma.dropdownOption.findMany({
      where: { type: 'COURSE', isActive: true },
      // sortOrder first so an admin can float the courses they sell most to
      // the top; name as the tiebreaker so equal ordering is still stable.
      orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }],
      select: { id: true, value: true },
    });

    // `name` rather than `value`: the shape the six existing callers expect.
    return NextResponse.json(courses.map((c) => ({ id: c.id, name: c.value })));
  } catch (error) {
    console.error('[courses GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
