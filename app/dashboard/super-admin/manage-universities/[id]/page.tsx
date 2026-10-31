'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, AlertTriangle } from 'lucide-react';
import { UniversityEditor } from '@/components/universities/university-editor';
import { toEditorSections } from '@/lib/university-profile';

/**
 * Editing one university.
 *
 * The profile is fetched with ?edit=1, which is what lets an unpublished
 * university be opened at all — the public read deliberately only returns
 * live ones.
 */
export default function EditUniversityPage({ params }: { params: { id: string } }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['university-edit', params.id],
    queryFn: async () => {
      const res = await fetch(`/api/universities/${params.id}?edit=1`);
      if (!res.ok) throw new Error('Could not load that university.');
      return res.json();
    },
    // The editor holds the form state; refetching underneath it would throw
    // away whatever is being typed.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-10 text-center">
        <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
        <p className="text-sm font-semibold">That university could not be loaded.</p>
        <Link
          href="/dashboard/super-admin/manage-universities"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Back to Manage Universities
        </Link>
      </div>
    );
  }

  return (
    <UniversityEditor
      universityId={data.id}
      initial={{ ...data, sections: toEditorSections(data) }}
    />
  );
}
