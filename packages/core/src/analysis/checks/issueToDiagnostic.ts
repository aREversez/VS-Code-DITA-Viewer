// The single place that turns a completeness Issue into a host diagnostic (DESIGN.md 4.4).
// Issue lines are 1-based; DitaDiagnostic lines are 0-based with an exclusive end, so a
// finding on line n covers all of it: start (n-1, 0), end (n, 0). The two conversions
// DitaDiagnostic cannot express are recorded here rather than scattered over hosts: its
// severity has no "info" (the one info finding, prof.notConfigured, reads as a warning),
// and it carries no related locations (the UI layer keeps using Issue for those).

import type { DitaDiagnostic } from '../../diagnostics';
import type { Issue } from './checkTypes';

export function issueToDiagnostic(issue: Issue): DitaDiagnostic {
  const line = Math.max(0, issue.line - 1);
  return {
    severity: issue.severity === 'info' ? 'warning' : issue.severity,
    message: issue.message,
    startLine: line,
    startCol: 0,
    endLine: line + 1,
    endCol: 0,
  };
}
