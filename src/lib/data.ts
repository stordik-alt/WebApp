import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DailyRecord, Employee, WeeklyRecord } from "./metrics";
import type { Product, ProductNorm } from "./products";
import { aggregateShifts, type ShiftEvaluation } from "./shifts";
import type { NormRemeasurement, ProductShift } from "./remeasure";

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as Employee[];
    },
  });
}

export function useDailyRecords(from?: string, to?: string) {
  return useQuery({
    queryKey: ["daily", from ?? null, to ?? null],
    queryFn: async () => {
      let q = supabase
        .from("daily_records")
        .select("*")
        .eq("approval_status", "approved")
        .order("work_date", { ascending: false });
      if (from) q = q.gte("work_date", from);
      if (to) q = q.lte("work_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        oee: r.oee === null ? null : Number(r.oee),
        help_score: Number(r.help_score),
        performance: r.performance === null || r.performance === undefined ? null : Number(r.performance),
        available_time:
          r.available_time === null || r.available_time === undefined ? null : Number(r.available_time),
      })) as unknown as DailyRecord[];
    },
  });
}

export function useWeeklyRecords() {
  return useQuery({
    queryKey: ["weekly"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_records")
        .select("*")
        .eq("approval_status", "approved")
        .order("iso_year", { ascending: false })
        .order("iso_week", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        yield_pct: Number(r.yield_pct),
        auto_quality_score: r.auto_quality_score === null ? null : Number(r.auto_quality_score),
        final_quality_score: r.final_quality_score === null ? null : Number(r.final_quality_score),
      })) as unknown as WeeklyRecord[];
    },
  });
}

export function useCoworkerLinks() {
  return useQuery({
    queryKey: ["coworkers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("daily_record_coworkers").select("*");
      if (error) throw error;
      return (data ?? []) as { record_id: string; coworker_id: string }[];
    },
  });
}

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("approval_status", "approved")
        .order("code");
      if (error) throw error;
      return (data ?? []) as unknown as Product[];
    },
  });
}

export function useProductNorms() {
  return useQuery({
    queryKey: ["product_norms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_norms")
        .select("*")
        .eq("approval_status", "approved")
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((n) => ({
        ...n,
        norm_per_hour: Number(n.norm_per_hour),
      })) as unknown as ProductNorm[];
    },
  });
}

export function useShiftEvaluations() {
  return useQuery({
    queryKey: ["shift_evaluations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_evaluations")
        .select("*")
        .eq("approval_status", "approved");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        help_score: Number(r.help_score),
      })) as unknown as ShiftEvaluation[];
    },
  });
}

/**
 * Směnové agregáty (jednotka denního výkonu) – počítané dynamicky
 * z linkových záznamů, nikdy se neukládají zpět do databáze.
 */
export function useShiftAggregates(from?: string, to?: string) {
  const daily = useDailyRecords(from, to);
  const evals = useShiftEvaluations();
  const links = useCoworkerLinks();
  const emp = useEmployees();
  const shifts = useMemo(
    () =>
      aggregateShifts(
        daily.data ?? [],
        evals.data ?? [],
        links.data ?? [],
        emp.data ?? [],
      ),
    [daily.data, evals.data, links.data, emp.data],
  );
  return {
    shifts,
    records: daily.data ?? [],
    evaluations: evals.data ?? [],
    links: links.data ?? [],
    isLoading: daily.isLoading || evals.isLoading || links.isLoading || emp.isLoading,
  };
}

export function useNormRemeasurements() {
  return useQuery({
    queryKey: ["norm_remeasurements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("norm_remeasurements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        shifts: (r.shifts ?? []) as unknown as ProductShift[],
        avg_oee: r.avg_oee === null ? null : Number(r.avg_oee),
        current_norm_ha: r.current_norm_ha === null ? null : Number(r.current_norm_ha),
        current_norm_tup: r.current_norm_tup === null ? null : Number(r.current_norm_tup),
        result_norm_ha: r.result_norm_ha === null ? null : Number(r.result_norm_ha),
        result_norm_tup: r.result_norm_tup === null ? null : Number(r.result_norm_tup),
      })) as unknown as NormRemeasurement[];
    },
  });
}

export function useHandlerEvaluations() {
  return useQuery({
    queryKey: ["handler_evaluations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("handler_evaluations")
        .select("*")
        .eq("approval_status", "approved")
        .order("work_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        score: Number(r.score),
      })) as unknown as import("@/lib/handler-eval").HandlerEvaluation[];
    },
  });
}

export function useWeeklyHandlerEvaluations() {
  return useQuery({
    queryKey: ["weekly_handler_evaluations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_handler_evaluations")
        .select("*")
        .eq("approval_status", "approved")
        .order("iso_year", { ascending: false })
        .order("iso_week", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        avg_score: Number(r.avg_score),
      })) as unknown as import("@/lib/handler-eval").WeeklyHandlerEvaluation[];
    },
  });
}

export type QualityAlertHistoryEntry = {
  id: string;
  weekly_record_id: string;
  alert_cause: string | null;
  alert_note: string | null;
  operator_error: boolean | null;
  final_quality_score: number | null;
  alert_resolved: boolean;
  changed_by_email: string | null;
  created_at: string;
};

export function useQualityAlertHistory(weeklyRecordId?: string) {
  return useQuery({
    queryKey: ["quality_alert_history", weeklyRecordId ?? null],
    enabled: !!weeklyRecordId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_alert_history")
        .select("*")
        .eq("weekly_record_id", weeklyRecordId!)
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((h) => ({
        ...h,
        final_quality_score:
          h.final_quality_score === null ? null : Number(h.final_quality_score),
      })) as unknown as QualityAlertHistoryEntry[];
    },
  });
}
