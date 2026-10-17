import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="COLLEGE"
        title="Manage Colleges"
        description="Manage colleges. CSV uploads and the API match on the college name, ignoring capitalisation and surrounding spaces, and the lead is saved with the spelling set here. Zone and Deal Type set here are applied to every lead ingested for the college."
        placeholder="e.g. IIT Delhi"
        collegeAttributes
      />
    </div>
  );
}
