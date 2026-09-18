import { bugReportSchema } from '../shared/schemas'
import type { BugReport } from '../shared/types'

export function validateReport(report: BugReport): BugReport {
  return bugReportSchema.parse(report)
}
