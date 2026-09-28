import { FileText, Target } from 'lucide-react';
import { EmptyState } from '@/components/ui';

/** Routes reserved in the navigation for modules that are not built yet. */
export function GoalsPage() {
  return (
    <div className="page">
      <EmptyState icon={<Target size={32} />} title="Goals are coming soon">
        OKRs and goals linked to projects and tasks will live here. The route and navigation are in place; the module is not implemented yet.
      </EmptyState>
    </div>
  );
}

export function DocumentsPage() {
  return (
    <div className="page">
      <EmptyState icon={<FileText size={32} />} title="Documents are coming soon">
        Project docs and specs will live here. The route and navigation are in place; the module is not implemented yet.
      </EmptyState>
    </div>
  );
}
