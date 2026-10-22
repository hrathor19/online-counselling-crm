import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="COURSE"
        title="Manage Courses"
        description="The courses this team sells. Add Lead offers exactly this list, and CSV upload matches against it — ignoring capitalisation and surrounding spaces — saving the lead with the spelling set here. A course that is not on this list is rejected on upload, so add it before importing leads for it."
        placeholder="e.g. Online MBA"
      />
    </div>
  );
}
