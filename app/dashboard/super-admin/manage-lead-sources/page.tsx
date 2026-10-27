import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="LEAD_CODE"
        title="Manage Lead Sources"
        description="Where leads come from. Add Lead offers exactly this list, and CSV upload matches against it — ignoring capitalisation and surrounding spaces — saving the lead with the spelling set here. A source that is not on this list is rejected on upload, so add it before importing leads for it."
        placeholder="e.g. Google_Ads"
      />
    </div>
  );
}
