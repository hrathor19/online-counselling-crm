'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { LeadIntegrationBuilder } from '@/components/lead-integrations/integration-builder';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

export default function CollegeIntegrationEditorPage({ params }: { params: { collegeId: string; integrationId: string } }) {
  return (
    <PinGate action={PIN_GATED_ACTIONS.LEAD_INTEGRATIONS} title="College API Push">
      <Editor collegeId={params.collegeId} integrationId={params.integrationId} />
    </PinGate>
  );
}

function Editor({ collegeId, integrationId }: { collegeId: string; integrationId: string }) {
  const isNew = integrationId === 'new';
  // The college's name is needed up front for a new integration (there is no
  // saved integration to read it from yet).
  const { data, isLoading } = useQuery<{ college: { id: string; value: string } }>({
    queryKey: ['college-integration-college', collegeId],
    queryFn: () => fetch(`/api/super-admin/college-integrations/${collegeId}`).then((r) => r.json()),
    enabled: isNew,
  });

  if (isNew && isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <LeadIntegrationBuilder
      integrationId={isNew ? undefined : integrationId}
      collegeOptionId={collegeId}
      collegeName={data?.college?.value}
    />
  );
}
