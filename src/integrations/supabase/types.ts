export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      daily_record_coworkers: {
        Row: {
          coworker_id: string;
          record_id: string;
        };
        Insert: {
          coworker_id: string;
          record_id: string;
        };
        Update: {
          coworker_id?: string;
          record_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_record_coworkers_coworker_id_fkey";
            columns: ["coworker_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_record_coworkers_record_id_fkey";
            columns: ["record_id"];
            isOneToOne: false;
            referencedRelation: "daily_records";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_records: {
        Row: {
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          available_time: number | null;
          created_at: string;
          employee_id: string;
          help_score: number;
          id: string;
          import_batch_id: string | null;
          is_demo: boolean;
          line: string;
          note: string | null;
          oee: number | null;
          performance: number | null;
          position: string;
          product: string | null;
          product_id: string | null;
          screenshot_path: string | null;
          shift: string;
          source: string;
          submitted_by: string | null;
          updated_at: string;
          work_date: string;
        };
        Insert: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          available_time?: number | null;
          created_at?: string;
          employee_id: string;
          help_score?: number;
          id?: string;
          import_batch_id?: string | null;
          is_demo?: boolean;
          line: string;
          note?: string | null;
          oee?: number | null;
          performance?: number | null;
          position: string;
          product?: string | null;
          product_id?: string | null;
          screenshot_path?: string | null;
          shift: string;
          source?: string;
          submitted_by?: string | null;
          updated_at?: string;
          work_date: string;
        };
        Update: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          available_time?: number | null;
          created_at?: string;
          employee_id?: string;
          help_score?: number;
          id?: string;
          import_batch_id?: string | null;
          is_demo?: boolean;
          line?: string;
          note?: string | null;
          oee?: number | null;
          performance?: number | null;
          position?: string;
          product?: string | null;
          product_id?: string | null;
          screenshot_path?: string | null;
          shift?: string;
          source?: string;
          submitted_by?: string | null;
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_records_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_records_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          active: boolean;
          created_at: string;
          full_name: string;
          id: string;
          is_demo: boolean;
          is_temporary: boolean;
          note: string | null;
          personal_no: string | null;
          position_type: "standard" | "handler" | "vlnař";
          qual_ha: boolean;
          qual_tup: boolean;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          full_name: string;
          id?: string;
          is_demo?: boolean;
          is_temporary?: boolean;
          note?: string | null;
          personal_no?: string | null;
          position_type?: "standard" | "handler" | "vlnař";
          qual_ha?: boolean;
          qual_tup?: boolean;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_demo?: boolean;
          is_temporary?: boolean;
          note?: string | null;
          personal_no?: string | null;
          position_type?: "standard" | "handler" | "vlnař";
          qual_ha?: boolean;
          qual_tup?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      norm_remeasurements: {
        Row: {
          avg_oee: number | null;
          confirmed_by: string | null;
          created_at: string;
          current_norm_ha: number | null;
          current_norm_tup: number | null;
          decided_at: string | null;
          decided_by: string | null;
          id: string;
          is_demo: boolean;
          product_code: string;
          product_id: string | null;
          result_applied_at: string | null;
          result_norm_ha: number | null;
          result_norm_tup: number | null;
          result_note: string | null;
          result_valid_from: string | null;
          shifts: Json;
          status: string;
          trigger_key: string;
          updated_at: string;
        };
        Insert: {
          avg_oee?: number | null;
          confirmed_by?: string | null;
          created_at?: string;
          current_norm_ha?: number | null;
          current_norm_tup?: number | null;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          is_demo?: boolean;
          product_code: string;
          product_id?: string | null;
          result_applied_at?: string | null;
          result_norm_ha?: number | null;
          result_norm_tup?: number | null;
          result_note?: string | null;
          result_valid_from?: string | null;
          shifts?: Json;
          status?: string;
          trigger_key: string;
          updated_at?: string;
        };
        Update: {
          avg_oee?: number | null;
          confirmed_by?: string | null;
          created_at?: string;
          current_norm_ha?: number | null;
          current_norm_tup?: number | null;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          is_demo?: boolean;
          product_code?: string;
          product_id?: string | null;
          result_applied_at?: string | null;
          result_norm_ha?: number | null;
          result_norm_tup?: number | null;
          result_note?: string | null;
          result_valid_from?: string | null;
          shifts?: Json;
          status?: string;
          trigger_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "norm_remeasurements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_norms: {
        Row: {
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          confirmed: boolean;
          created_at: string;
          id: string;
          is_demo: boolean;
          norm_per_hour: number;
          note: string | null;
          operation: string;
          product_id: string;
          source: string;
          submitted_by: string | null;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          confirmed?: boolean;
          created_at?: string;
          id?: string;
          is_demo?: boolean;
          norm_per_hour: number;
          note?: string | null;
          operation: string;
          product_id: string;
          source?: string;
          submitted_by?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          confirmed?: boolean;
          created_at?: string;
          id?: string;
          is_demo?: boolean;
          norm_per_hour?: number;
          note?: string | null;
          operation?: string;
          product_id?: string;
          source?: string;
          submitted_by?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_norms_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          code: string;
          created_at: string;
          employees_per_product: number;
          first_seen_date: string;
          id: string;
          is_demo: boolean;
          name: string | null;
          note: string | null;
          submitted_by: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          code: string;
          created_at?: string;
          employees_per_product?: number;
          first_seen_date?: string;
          id?: string;
          is_demo?: boolean;
          name?: string | null;
          note?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          code?: string;
          created_at?: string;
          employees_per_product?: number;
          first_seen_date?: string;
          id?: string;
          is_demo?: boolean;
          name?: string | null;
          note?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          employee_id: string | null;
          first_name: string;
          id: string;
          last_name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          employee_id?: string | null;
          first_name?: string;
          id: string;
          last_name?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          employee_id?: string | null;
          first_name?: string;
          id?: string;
          last_name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      quality_alert_history: {
        Row: {
          alert_cause: string | null;
          alert_note: string | null;
          alert_resolved: boolean;
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          changed_by: string | null;
          changed_by_email: string | null;
          created_at: string;
          final_quality_score: number | null;
          id: string;
          operator_error: boolean | null;
          submitted_by: string | null;
          weekly_record_id: string;
        };
        Insert: {
          alert_cause?: string | null;
          alert_note?: string | null;
          alert_resolved?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          changed_by?: string | null;
          changed_by_email?: string | null;
          created_at?: string;
          final_quality_score?: number | null;
          id?: string;
          operator_error?: boolean | null;
          submitted_by?: string | null;
          weekly_record_id: string;
        };
        Update: {
          alert_cause?: string | null;
          alert_note?: string | null;
          alert_resolved?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          changed_by?: string | null;
          changed_by_email?: string | null;
          created_at?: string;
          final_quality_score?: number | null;
          id?: string;
          operator_error?: boolean | null;
          submitted_by?: string | null;
          weekly_record_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quality_alert_history_weekly_record_id_fkey";
            columns: ["weekly_record_id"];
            isOneToOne: false;
            referencedRelation: "weekly_records";
            referencedColumns: ["id"];
          },
        ];
      };
      shift_evaluations: {
        Row: {
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          employee_id: string;
          help_score: number;
          id: string;
          is_demo: boolean;
          note: string | null;
          shift: string;
          submitted_by: string | null;
          updated_at: string;
          work_date: string;
        };
        Insert: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          employee_id: string;
          help_score?: number;
          id?: string;
          is_demo?: boolean;
          note?: string | null;
          shift: string;
          submitted_by?: string | null;
          updated_at?: string;
          work_date: string;
        };
        Update: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          employee_id?: string;
          help_score?: number;
          id?: string;
          is_demo?: boolean;
          note?: string | null;
          shift?: string;
          submitted_by?: string | null;
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_evaluations_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      handler_evaluations: {
        Row: {
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          employee_id: string;
          id: string;
          is_demo: boolean;
          note: string | null;
          score: number;
          shift: string;
          submitted_by: string | null;
          updated_at: string;
          work_date: string;
        };
        Insert: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          employee_id: string;
          id?: string;
          is_demo?: boolean;
          note?: string | null;
          score?: number;
          shift: string;
          submitted_by?: string | null;
          updated_at?: string;
          work_date: string;
        };
        Update: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          employee_id?: string;
          id?: string;
          is_demo?: boolean;
          note?: string | null;
          score?: number;
          shift?: string;
          submitted_by?: string | null;
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "handler_evaluations_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      weekly_handler_evaluations: {
        Row: {
          alert_cause: string | null;
          alert_note: string | null;
          alert_resolved: boolean;
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          avg_score: number;
          created_at: string;
          employee_id: string;
          id: string;
          is_alert: boolean;
          is_demo: boolean;
          iso_week: number;
          iso_year: number;
          submitted_by: string | null;
          updated_at: string;
        };
        Insert: {
          alert_cause?: string | null;
          alert_note?: string | null;
          alert_resolved?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          avg_score?: number;
          created_at?: string;
          employee_id: string;
          id?: string;
          is_alert?: boolean;
          is_demo?: boolean;
          iso_week: number;
          iso_year: number;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Update: {
          alert_cause?: string | null;
          alert_note?: string | null;
          alert_resolved?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          avg_score?: number;
          created_at?: string;
          employee_id?: string;
          id?: string;
          is_alert?: boolean;
          is_demo?: boolean;
          iso_week?: number;
          iso_year?: number;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_handler_evaluations_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      weekly_records: {
        Row: {
          alert_cause: string | null;
          alert_note: string | null;
          alert_resolved: boolean;
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          auto_quality_score: number | null;
          created_at: string;
          employee_id: string;
          final_quality_score: number | null;
          id: string;
          is_alert: boolean | null;
          is_demo: boolean;
          iso_week: number;
          iso_year: number;
          operator_error: boolean | null;
          submitted_by: string | null;
          updated_at: string;
          yield_pct: number;
        };
        Insert: {
          alert_cause?: string | null;
          alert_note?: string | null;
          alert_resolved?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          auto_quality_score?: number | null;
          created_at?: string;
          employee_id: string;
          final_quality_score?: number | null;
          id?: string;
          is_alert?: boolean | null;
          is_demo?: boolean;
          iso_week: number;
          iso_year: number;
          operator_error?: boolean | null;
          submitted_by?: string | null;
          updated_at?: string;
          yield_pct: number;
        };
        Update: {
          alert_cause?: string | null;
          alert_note?: string | null;
          alert_resolved?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          auto_quality_score?: number | null;
          created_at?: string;
          employee_id?: string;
          final_quality_score?: number | null;
          id?: string;
          is_alert?: boolean | null;
          is_demo?: boolean;
          iso_week?: number;
          iso_year?: number;
          operator_error?: boolean | null;
          submitted_by?: string | null;
          updated_at?: string;
          yield_pct?: number;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_records_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_set_role: {
        Args: { _role: string; _user_id: string };
        Returns: undefined;
      };
      current_employee_id: { Args: never; Returns: string };
      ensure_profile: {
        Args: { _first_name: string; _last_name: string };
        Returns: {
          created_at: string;
          email: string | null;
          employee_id: string | null;
          first_name: string;
          id: string;
          last_name: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      has_app_role: {
        Args: { _role: string; _user_id: string };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "user" | "team_leader" | "operator";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "team_leader", "operator"],
    },
  },
} as const;
