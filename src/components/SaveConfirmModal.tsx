import { AlertTriangle, ArrowLeft, Save, Settings2 } from 'lucide-react';

export type SaveConfirmIssue =
  | { type: 'skipped'; label: string }
  | { type: 'too_low'; label: string; value: number; limit: number }
  | { type: 'too_high'; label: string; value: number; limit: number };

interface SaveConfirmModalProps {
  issues: SaveConfirmIssue[];
  /** Called when the user wants to go back and edit */
  onGoBack: () => void;
  /** Called when the user confirms they want to save anyway */
  onSaveAnyway: () => void;
  /**
   * Optional — if provided, a small secondary action at the bottom will
   * offer to navigate to Let's Manage to reduce the probe count.
   * Only meaningful when at least one skipped-probe issue exists.
   */
  onReduceProbes?: () => void;
  saving?: boolean;
  /** Title shown in the modal header. Default: "Hold on — before you save" */
  title?: string;
  /** Subtitle/description shown under the title. */
  subtitle?: string;
  /** Label for the primary (top) button. Default: "Go back and edit" */
  primaryLabel?: string;
  /** Label for the secondary button. Default: "Save anyway" */
  secondaryLabel?: string;
}

function formatIssue(issue: SaveConfirmIssue): string {
  switch (issue.type) {
    case 'skipped':
      return `${issue.label}: not measured`;
    case 'too_low':
      return `${issue.label}: ${issue.value}°F — below ${issue.limit}°F`;
    case 'too_high':
      return `${issue.label}: ${issue.value}°F — above ${issue.limit}°F`;
  }
}

export function SaveConfirmModal({
  issues,
  onGoBack,
  onSaveAnyway,
  onReduceProbes,
  saving = false,
  title = 'Hold on — before you save',
  subtitle = 'We spotted something that looks unusual. Please double-check.',
  primaryLabel = 'Go back and edit',
  secondaryLabel = 'Save anyway',
}: SaveConfirmModalProps) {
  const hasSkipped = issues.some(i => i.type === 'skipped');
  const showReduceProbes = hasSkipped && !!onReduceProbes;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onGoBack}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
              <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
            </div>
          </div>
        </div>

        {/* Issues list */}
        <div className="p-5 max-h-64 overflow-y-auto">
          <ul className="space-y-1.5">
            {issues.map((issue, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-amber-500 flex-shrink-0">•</span>
                <span>{formatIssue(issue)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Primary actions */}
        <div className="p-5 pt-0 space-y-2">
          <button
            onClick={onGoBack}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-green-primary text-white font-semibold text-base active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <ArrowLeft size={18} />
            {primaryLabel}
          </button>
          <button
            onClick={onSaveAnyway}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-medium text-sm active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving…' : secondaryLabel}
          </button>
        </div>

        {/* Small secondary option for reducing probes */}
        {showReduceProbes && (
          <div className="px-5 pb-5">
            <div className="border-t border-gray-100 pt-3">
              <button
                onClick={onReduceProbes}
                disabled={saving}
                className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Settings2 size={12} />
                Reduce probe count in Let's Manage
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-0.5 leading-tight">
                You'll need to start this reading over
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
