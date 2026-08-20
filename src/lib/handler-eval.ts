/**
 * Typy pro hodnocení handlerů a vlnařů.
 * Tyto pozice nemají OEE/normy, ale denní/týdenní hodnocení práce.
 */

export type HandlerEvaluation = {
  id: string;
  employee_id: string;
  work_date: string;
  shift: string;
  score: number; // 0-100
  note: string | null;
  is_demo: boolean;
  created_at: string;
};

export type WeeklyHandlerEvaluation = {
  id: string;
  employee_id: string;
  iso_year: number;
  iso_week: number;
  avg_score: number;
  is_alert: boolean;
  alert_cause: string | null;
  alert_note: string | null;
  is_demo: boolean;
};
