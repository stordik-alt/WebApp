export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      approval_audit_log: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          id: string;
          new_status: string;
          previous_status: string | null;
          record_id: string;
          rejection_reason: string | null;
          table_name: string;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          new_status: string;
          previous_status?: string | null;
          record_id: string;
          rejection_reason?: string | null;
          table_name: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          new_status?: string;
          previous_status?: string | null;
          record_id?: string;
          rejection_reason?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
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
          extracted_at: string | null;
          help_score: number;
          id: string;
          import_batch_id: string | null;
          import_item_id: string | null;
          is_demo: boolean;
          line: string;
          note: string | null;
          ocr_confidence: number | null;
          oee: number | null;
          performance: number | null;
          position: string;
          predicted_shift_output: number | null;
          product: string | null;
          product_id: string | null;
          productive_minutes: number | null;
          rejection_reason: string | null;
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
          extracted_at?: string | null;
          help_score?: number;
          id?: string;
          import_batch_id?: string | null;
          import_item_id?: string | null;
          is_demo?: boolean;
          line: string;
          note?: string | null;
          ocr_confidence?: number | null;
          oee?: number | null;
          performance?: number | null;
          position: string;
          predicted_shift_output?: number | null;
          product?: string | null;
          product_id?: string | null;
          productive_minutes?: number | null;
          rejection_reason?: string | null;
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
          extracted_at?: string | null;
          help_score?: number;
          id?: string;
          import_batch_id?: string | null;
          import_item_id?: string | null;
          is_demo?: boolean;
          line?: string;
          note?: string | null;
          ocr_confidence?: number | null;
          oee?: number | null;
          performance?: number | null;
          position?: string;
          predicted_shift_output?: number | null;
          product?: string | null;
          product_id?: string | null;
          productive_minutes?: number | null;
          rejection_reason?: string | null;
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
            foreignKeyName: "daily_records_import_item_id_fkey";
            columns: ["import_item_id"];
            isOneToOne: false;
            referencedRelation: "import_items";
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
      downtime_reason_classifications: {
        Row: {
          active: boolean;
          category: string;
          created_at: string;
          id: string;
          note: string | null;
          reason_text: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          category: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          reason_text: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          category?: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          reason_text?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          position_type: Database["public"]["Enums"]["employee_position_type"];
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
          position_type?: Database["public"]["Enums"]["employee_position_type"];
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
          position_type?: Database["public"]["Enums"]["employee_position_type"];
          qual_ha?: boolean;
          qual_tup?: boolean;
          updated_at?: string;
        };
        Relationships: [];
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
          score: number;
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
      import_batches: {
        Row: {
          auto_items: number;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          error_items: number;
          id: string;
          metadata: Json;
          pending_items: number;
          processed_items: number;
          status: string;
          total_items: number;
        };
        Insert: {
          auto_items?: number;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          error_items?: number;
          id?: string;
          metadata?: Json;
          pending_items?: number;
          processed_items?: number;
          status?: string;
          total_items?: number;
        };
        Update: {
          auto_items?: number;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          error_items?: number;
          id?: string;
          metadata?: Json;
          pending_items?: number;
          processed_items?: number;
          status?: string;
          total_items?: number;
        };
        Relationships: [];
      };
      import_item_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          event_type: string;
          from_status: string | null;
          id: string;
          import_item_id: string;
          payload: Json;
          to_status: string | null;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          event_type: string;
          from_status?: string | null;
          id?: string;
          import_item_id: string;
          payload?: Json;
          to_status?: string | null;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          event_type?: string;
          from_status?: string | null;
          id?: string;
          import_item_id?: string;
          payload?: Json;
          to_status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "import_item_events_import_item_id_fkey";
            columns: ["import_item_id"];
            isOneToOne: false;
            referencedRelation: "import_items";
            referencedColumns: ["id"];
          },
        ];
      };
      import_item_hourly: {
        Row: {
          actual_minutes: number | null;
          actual_oee_pct: number | null;
          actual_output: number | null;
          admin_corrections: Json;
          availability_pct: number | null;
          capacity: number | null;
          created_at: string;
          hour: number;
          id: string;
          import_item_id: string;
          norm_per_hour: number | null;
          operator_count: number | null;
          performance_pct: number | null;
          product_code: string | null;
          raw_data: Json;
          role: string | null;
          stat_status: string;
          updated_at: string;
        };
        Insert: {
          actual_minutes?: number | null;
          actual_oee_pct?: number | null;
          actual_output?: number | null;
          admin_corrections?: Json;
          availability_pct?: number | null;
          capacity?: number | null;
          created_at?: string;
          hour: number;
          id?: string;
          import_item_id: string;
          norm_per_hour?: number | null;
          operator_count?: number | null;
          performance_pct?: number | null;
          product_code?: string | null;
          raw_data?: Json;
          role?: string | null;
          stat_status?: string;
          updated_at?: string;
        };
        Update: {
          actual_minutes?: number | null;
          actual_oee_pct?: number | null;
          actual_output?: number | null;
          admin_corrections?: Json;
          availability_pct?: number | null;
          capacity?: number | null;
          created_at?: string;
          hour?: number;
          id?: string;
          import_item_id?: string;
          norm_per_hour?: number | null;
          operator_count?: number | null;
          performance_pct?: number | null;
          product_code?: string | null;
          raw_data?: Json;
          role?: string | null;
          stat_status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_item_hourly_import_item_id_fkey";
            columns: ["import_item_id"];
            isOneToOne: false;
            referencedRelation: "import_items";
            referencedColumns: ["id"];
          },
        ];
      };
      import_item_hourly_stat_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          from_status: string | null;
          id: string;
          import_item_hourly_id: string;
          note: string | null;
          reason: string | null;
          to_status: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          import_item_hourly_id: string;
          note?: string | null;
          reason?: string | null;
          to_status: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          import_item_hourly_id?: string;
          note?: string | null;
          reason?: string | null;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_item_hourly_stat_events_import_item_hourly_id_fkey";
            columns: ["import_item_hourly_id"];
            isOneToOne: false;
            referencedRelation: "import_item_hourly";
            referencedColumns: ["id"];
          },
        ];
      };
      import_item_rows: {
        Row: {
          admin_corrections: Json;
          available_time: number | null;
          confidence: number | null;
          created_at: string;
          daily_record_id: string | null;
          employee_id: string | null;
          help_score: number | null;
          id: string;
          import_item_id: string;
          match_status: string;
          ocr_employee_name: string | null;
          oee: number | null;
          performance: number | null;
          position: string | null;
          raw_data: Json;
          row_index: number;
          updated_at: string;
          validation_status: string;
        };
        Insert: {
          admin_corrections?: Json;
          available_time?: number | null;
          confidence?: number | null;
          created_at?: string;
          daily_record_id?: string | null;
          employee_id?: string | null;
          help_score?: number | null;
          id?: string;
          import_item_id: string;
          match_status?: string;
          ocr_employee_name?: string | null;
          oee?: number | null;
          performance?: number | null;
          position?: string | null;
          raw_data?: Json;
          row_index: number;
          updated_at?: string;
          validation_status?: string;
        };
        Update: {
          admin_corrections?: Json;
          available_time?: number | null;
          confidence?: number | null;
          created_at?: string;
          daily_record_id?: string | null;
          employee_id?: string | null;
          help_score?: number | null;
          id?: string;
          import_item_id?: string;
          match_status?: string;
          ocr_employee_name?: string | null;
          oee?: number | null;
          performance?: number | null;
          position?: string | null;
          raw_data?: Json;
          row_index?: number;
          updated_at?: string;
          validation_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_item_rows_daily_record_id_fkey";
            columns: ["daily_record_id"];
            isOneToOne: false;
            referencedRelation: "daily_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_item_rows_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_item_rows_import_item_id_fkey";
            columns: ["import_item_id"];
            isOneToOne: false;
            referencedRelation: "import_items";
            referencedColumns: ["id"];
          },
        ];
      };
      import_items: {
        Row: {
          admin_corrections: Json;
          approved_at: string | null;
          approved_by: string | null;
          batch_id: string;
          completed_at: string | null;
          conflict_daily_record_ids: string[] | null;
          conflict_resolution: string | null;
          conflict_resolved_at: string | null;
          conflict_resolved_by: string | null;
          created_at: string;
          error_message: string | null;
          id: string;
          line: string | null;
          norm_per_hour: number | null;
          ocr_confidence: number | null;
          ocr_data: Json;
          pending_reasons: Json;
          product_code: string | null;
          product_id: string | null;
          product_match_status: string;
          product_name: string | null;
          product_profile_status: string;
          reimport_of_id: string | null;
          rejected_at: string | null;
          rejected_by: string | null;
          rejection_reason: string | null;
          screenshot_path: string;
          shift: string | null;
          source_hash: string;
          status: string;
          trace_id: string | null;
          updated_at: string;
          work_date: string | null;
        };
        Insert: {
          admin_corrections?: Json;
          approved_at?: string | null;
          approved_by?: string | null;
          batch_id: string;
          completed_at?: string | null;
          conflict_daily_record_ids?: string[] | null;
          conflict_resolution?: string | null;
          conflict_resolved_at?: string | null;
          conflict_resolved_by?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          line?: string | null;
          norm_per_hour?: number | null;
          ocr_confidence?: number | null;
          ocr_data?: Json;
          pending_reasons?: Json;
          product_code?: string | null;
          product_id?: string | null;
          product_match_status?: string;
          product_name?: string | null;
          product_profile_status?: string;
          reimport_of_id?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          screenshot_path: string;
          shift?: string | null;
          source_hash: string;
          status?: string;
          trace_id?: string | null;
          updated_at?: string;
          work_date?: string | null;
        };
        Update: {
          admin_corrections?: Json;
          approved_at?: string | null;
          approved_by?: string | null;
          batch_id?: string;
          completed_at?: string | null;
          conflict_daily_record_ids?: string[] | null;
          conflict_resolution?: string | null;
          conflict_resolved_at?: string | null;
          conflict_resolved_by?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          line?: string | null;
          norm_per_hour?: number | null;
          ocr_confidence?: number | null;
          ocr_data?: Json;
          pending_reasons?: Json;
          product_code?: string | null;
          product_id?: string | null;
          product_match_status?: string;
          product_name?: string | null;
          product_profile_status?: string;
          reimport_of_id?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          screenshot_path?: string;
          shift?: string | null;
          source_hash?: string;
          status?: string;
          trace_id?: string | null;
          updated_at?: string;
          work_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "import_items_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_items_reimport_of_id_fkey";
            columns: ["reimport_of_id"];
            isOneToOne: false;
            referencedRelation: "import_items";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shift_assignments: {
        Row: {
          assigned_at: string;
          assignment_type: string;
          employee_id: string;
          id: string;
          is_manual_override: boolean;
          production_id: string | null;
          shift_id: string;
          suggested_workstation_id: string | null;
          workstation_id: string | null;
        };
        Insert: {
          assigned_at?: string;
          assignment_type?: string;
          employee_id: string;
          id?: string;
          is_manual_override?: boolean;
          production_id?: string | null;
          shift_id: string;
          suggested_workstation_id?: string | null;
          workstation_id?: string | null;
        };
        Update: {
          assigned_at?: string;
          assignment_type?: string;
          employee_id?: string;
          id?: string;
          is_manual_override?: boolean;
          production_id?: string | null;
          shift_id?: string;
          suggested_workstation_id?: string | null;
          workstation_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shift_assignments_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_assignments_production_id_fkey";
            columns: ["production_id"];
            isOneToOne: false;
            referencedRelation: "iw_shift_productions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_assignments_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "iw_shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_assignments_suggested_workstation_id_fkey";
            columns: ["suggested_workstation_id"];
            isOneToOne: false;
            referencedRelation: "iw_workstations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_assignments_workstation_id_fkey";
            columns: ["workstation_id"];
            isOneToOne: false;
            referencedRelation: "iw_workstations";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shift_exceptions: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_id: string;
          exception_type: string;
          id: string;
          reason: string | null;
          shift: string;
          team_id: string;
          work_date: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_id: string;
          exception_type: string;
          id?: string;
          reason?: string | null;
          shift: string;
          team_id: string;
          work_date: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_id?: string;
          exception_type?: string;
          id?: string;
          reason?: string | null;
          shift?: string;
          team_id?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shift_exceptions_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_exceptions_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "iw_teams";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shift_history_segments: {
        Row: {
          coworker_employee_ids: string[];
          created_at: string;
          employee_id: string;
          id: string;
          product_code: string | null;
          production_id: string | null;
          result_snapshot: Json | null;
          segment_end_at: string | null;
          segment_start_at: string;
          shift_id: string;
          workstation_id: string;
        };
        Insert: {
          coworker_employee_ids?: string[];
          created_at?: string;
          employee_id: string;
          id?: string;
          product_code?: string | null;
          production_id?: string | null;
          result_snapshot?: Json | null;
          segment_end_at?: string | null;
          segment_start_at: string;
          shift_id: string;
          workstation_id: string;
        };
        Update: {
          coworker_employee_ids?: string[];
          created_at?: string;
          employee_id?: string;
          id?: string;
          product_code?: string | null;
          production_id?: string | null;
          result_snapshot?: Json | null;
          segment_end_at?: string | null;
          segment_start_at?: string;
          shift_id?: string;
          workstation_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shift_history_segments_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_history_segments_production_id_fkey";
            columns: ["production_id"];
            isOneToOne: false;
            referencedRelation: "iw_shift_productions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_history_segments_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "iw_shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_history_segments_workstation_id_fkey";
            columns: ["workstation_id"];
            isOneToOne: false;
            referencedRelation: "iw_workstations";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shift_productions: {
        Row: {
          area: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          priority: number | null;
          product_id: string | null;
          product_code: string;
          remaining_pieces: number;
          sequence_no: number;
          shift_id: string;
          started_at: string;
          updated_at: string;
          workstation_id: string;
        };
        Insert: {
          area: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          priority?: number | null;
          product_id?: string | null;
          product_code: string;
          remaining_pieces: number;
          sequence_no?: number;
          shift_id: string;
          started_at?: string;
          updated_at?: string;
          workstation_id: string;
        };
        Update: {
          area?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          priority?: number | null;
          product_id?: string | null;
          product_code?: string;
          remaining_pieces?: number;
          sequence_no?: number;
          shift_id?: string;
          started_at?: string;
          updated_at?: string;
          workstation_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shift_productions_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_productions_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "iw_shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_productions_workstation_id_fkey";
            columns: ["workstation_id"];
            isOneToOne: false;
            referencedRelation: "iw_workstations";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shift_snapshots: {
        Row: {
          confirmed_by: string;
          created_at: string;
          id: string;
          payload: Json;
          shift_id: string;
          snapshot_at: string;
        };
        Insert: {
          confirmed_by: string;
          created_at?: string;
          id?: string;
          payload: Json;
          shift_id: string;
          snapshot_at?: string;
        };
        Update: {
          confirmed_by?: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          shift_id?: string;
          snapshot_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shift_snapshots_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "iw_shifts";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shift_temp_operators: {
        Row: {
          added_at: string;
          added_by: string | null;
          added_reason: string | null;
          employee_id: string;
          id: string;
          shift_id: string;
        };
        Insert: {
          added_at?: string;
          added_by?: string | null;
          added_reason?: string | null;
          employee_id: string;
          id?: string;
          shift_id: string;
        };
        Update: {
          added_at?: string;
          added_by?: string | null;
          added_reason?: string | null;
          employee_id?: string;
          id?: string;
          shift_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shift_temp_operators_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_shift_temp_operators_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "iw_shifts";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_shifts: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          shift: string;
          started_at: string | null;
          started_by: string | null;
          status: string;
          team_id: string;
          updated_at: string;
          work_date: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          shift: string;
          started_at?: string | null;
          started_by?: string | null;
          status?: string;
          team_id: string;
          updated_at?: string;
          work_date: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          shift?: string;
          started_at?: string | null;
          started_by?: string | null;
          status?: string;
          team_id?: string;
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_shifts_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "iw_teams";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_team_members: {
        Row: {
          added_at: string;
          employee_id: string;
          id: string;
          team_id: string;
        };
        Insert: {
          added_at?: string;
          employee_id: string;
          id?: string;
          team_id: string;
        };
        Update: {
          added_at?: string;
          employee_id?: string;
          id?: string;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_team_members_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "iw_teams";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_teams: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          team_leader_user_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          team_leader_user_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          team_leader_user_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      iw_workstation_restrictions: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_id: string;
          id: string;
          reason: string | null;
          restriction_type: string;
          workstation_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_id: string;
          id?: string;
          reason?: string | null;
          restriction_type?: string;
          workstation_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_id?: string;
          id?: string;
          reason?: string | null;
          restriction_type?: string;
          workstation_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iw_workstation_restrictions_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iw_workstation_restrictions_workstation_id_fkey";
            columns: ["workstation_id"];
            isOneToOne: false;
            referencedRelation: "iw_workstations";
            referencedColumns: ["id"];
          },
        ];
      };
      iw_workstations: {
        Row: {
          active: boolean;
          area: string;
          code: string;
          created_at: string;
          display_name: string;
          group_name: string;
          id: string;
          is_secondary: boolean;
          note: string | null;
          requires_ha_qual: boolean;
          requires_tup_qual: boolean;
          sort_order: number;
          updated_at: string;
          workplace_id: string | null;
        };
        Insert: {
          active?: boolean;
          area: string;
          code: string;
          created_at?: string;
          display_name: string;
          group_name: string;
          id?: string;
          is_secondary?: boolean;
          note?: string | null;
          requires_ha_qual?: boolean;
          requires_tup_qual?: boolean;
          sort_order?: number;
          updated_at?: string;
          workplace_id?: string | null;
        };
        Update: {
          active?: boolean;
          area?: string;
          code?: string;
          created_at?: string;
          display_name?: string;
          group_name?: string;
          id?: string;
          is_secondary?: boolean;
          note?: string | null;
          requires_ha_qual?: boolean;
          requires_tup_qual?: boolean;
          sort_order?: number;
          updated_at?: string;
          workplace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "iw_workstations_workplace_id_fkey";
            columns: ["workplace_id"];
            isOneToOne: false;
            referencedRelation: "workplaces";
            referencedColumns: ["id"];
          },
        ];
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
      product_families: {
        Row: {
          created_at: string;
          h_product_id: string | null;
          id: string;
          name: string;
          t_product_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          h_product_id?: string | null;
          id?: string;
          name: string;
          t_product_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          h_product_id?: string | null;
          id?: string;
          name?: string;
          t_product_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_families_h_product_id_fkey";
            columns: ["h_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_families_t_product_id_fkey";
            columns: ["t_product_id"];
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
          rejection_reason: string | null;
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
          rejection_reason?: string | null;
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
          rejection_reason?: string | null;
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
      product_profiles: {
        Row: {
          created_at: string | null;
          h_capacity: number | null;
          h_norm_per_hour: number | null;
          ha_subassy: string | null;
          id: string;
          profile_key: string | null;
          profile_name: string | null;
          t_capacity: number | null;
          t_norm_per_hour: number | null;
          tup_subassy: string | null;
          updated_at: string | null;
          valid_from: string | null;
          valid_to: string | null;
          version_no: number | null;
        };
        Insert: {
          created_at?: string | null;
          h_capacity?: number | null;
          h_norm_per_hour?: number | null;
          ha_subassy?: string | null;
          id?: string;
          profile_key?: string | null;
          profile_name?: string | null;
          t_capacity?: number | null;
          t_norm_per_hour?: number | null;
          tup_subassy?: string | null;
          updated_at?: string | null;
          valid_from?: string | null;
          valid_to?: string | null;
          version_no?: number | null;
        };
        Update: {
          created_at?: string | null;
          h_capacity?: number | null;
          h_norm_per_hour?: number | null;
          ha_subassy?: string | null;
          id?: string;
          profile_key?: string | null;
          profile_name?: string | null;
          t_capacity?: number | null;
          t_norm_per_hour?: number | null;
          tup_subassy?: string | null;
          updated_at?: string | null;
          valid_from?: string | null;
          valid_to?: string | null;
          version_no?: number | null;
        };
        Relationships: [];
      };
      product_relationships: {
        Row: {
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          id: string;
          rejection_reason: string | null;
          relationship_type: string;
          source_product_id: string;
          submitted_by: string | null;
          target_product_id: string;
          updated_at: string;
        };
        Insert: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          id?: string;
          rejection_reason?: string | null;
          relationship_type?: string;
          source_product_id: string;
          submitted_by?: string | null;
          target_product_id: string;
          updated_at?: string;
        };
        Update: {
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          id?: string;
          rejection_reason?: string | null;
          relationship_type?: string;
          source_product_id?: string;
          submitted_by?: string | null;
          target_product_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_relationships_source_product_id_fkey";
            columns: ["source_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_relationships_target_product_id_fkey";
            columns: ["target_product_id"];
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
          family_id: string | null;
          first_seen_date: string;
          id: string;
          is_demo: boolean;
          name: string | null;
          note: string | null;
          rejection_reason: string | null;
          submitted_by: string | null;
          updated_at: string;
          variant_type: string | null;
        };
        Insert: {
          active?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          code: string;
          created_at?: string;
          employees_per_product?: number;
          family_id?: string | null;
          first_seen_date?: string;
          id?: string;
          is_demo?: boolean;
          name?: string | null;
          note?: string | null;
          rejection_reason?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
          variant_type?: string | null;
        };
        Update: {
          active?: boolean;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          code?: string;
          created_at?: string;
          employees_per_product?: number;
          family_id?: string | null;
          first_seen_date?: string;
          id?: string;
          is_demo?: boolean;
          name?: string | null;
          note?: string | null;
          rejection_reason?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
          variant_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "product_families";
            referencedColumns: ["id"];
          },
        ];
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
          rejection_reason: string | null;
          submitted_by: string | null;
          updated_at: string;
          weekly_record_id: string | null;
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
          rejection_reason?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
          weekly_record_id?: string | null;
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
          rejection_reason?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
          weekly_record_id?: string | null;
        };
        Relationships: [];
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
          rejection_reason: string | null;
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
          rejection_reason?: string | null;
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
          rejection_reason?: string | null;
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
          rejection_reason: string | null;
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
          rejection_reason?: string | null;
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
          rejection_reason?: string | null;
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
      workplaces: {
        Row: {
          area: string;
          code: string;
          created_at: string;
          id: string;
          line_name: string;
          source_line: string | null;
          updated_at: string;
          workplace_name: string;
        };
        Insert: {
          area: string;
          code: string;
          created_at?: string;
          id?: string;
          line_name: string;
          source_line?: string | null;
          updated_at?: string;
          workplace_name: string;
        };
        Update: {
          area?: string;
          code?: string;
          created_at?: string;
          id?: string;
          line_name?: string;
          source_line?: string | null;
          updated_at?: string;
          workplace_name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _historical_recompute_run: {
        Args: {
          p_sample_limit: number;
          p_work_date_from: string;
          p_work_date_to: string;
        };
        Returns: Json;
      };
      admin_set_role: {
        Args: { _role: string; _user_id: string };
        Returns: undefined;
      };
      apply_ha_tup_capping: {
        Args: {
          p_allocation_fraction?: number;
          p_tup_import_item_id: string;
          p_tup_product_code: string;
        };
        Returns: Json;
      };
      approve_import_item:
        | {
            Args: { p_actor_id?: string; p_import_item_id: string };
            Returns: Json;
          }
        | {
            Args: {
              p_actor_id?: string;
              p_confirm_conflict?: boolean;
              p_import_item_id: string;
            };
            Returns: Json;
          };
      approve_import_item_legacy:
        | {
            Args: { p_actor_id?: string; p_import_item_id: string };
            Returns: Json;
          }
        | {
            Args: {
              p_actor_id?: string;
              p_confirm_conflict?: boolean;
              p_import_item_id: string;
            };
            Returns: Json;
          };
      auto_approve_import_item: {
        Args: { p_import_item_id: string };
        Returns: Json;
      };
      auto_approve_import_item_legacy: {
        Args: { p_import_item_id: string };
        Returns: Json;
      };
      auto_resolve_import_shift: {
        Args: {
          p_import_item_id: string;
          p_screenshot_time: string;
          p_shift: string;
        };
        Returns: string;
      };
      auto_shift_productive_minutes: {
        Args: {
          p_hour: number;
          p_is_last_hour: boolean;
          p_screenshot_time: string;
          p_shift: string;
        };
        Returns: number;
      };
      auto_shift_start_minute: { Args: { p_shift: string }; Returns: number };
      classify_downtime_reason: { Args: { p_reason: string }; Returns: string };
      close_history_segment: {
        Args: { p_ended_at?: string; p_segment_id: string };
        Returns: undefined;
      };
      codes_match: { Args: { a: string; b: string }; Returns: boolean };
      compute_import_item_product_kpis: {
        Args: { p_import_item_id: string; p_work_date?: string };
        Returns: {
          availability: number;
          oee: number;
          performance: number;
          product_code: string;
          product_id: string;
          product_name: string;
          profile_complete: boolean;
          profile_id: string;
        }[];
      };
      current_employee_id: { Args: never; Returns: string };
      detect_performance_anomalies: {
        Args: {
          p_deviation_threshold?: number;
          p_work_date_from?: string;
          p_work_date_to?: string;
        };
        Returns: {
          available_time: number;
          employee_avg_oee: number;
          employee_avg_performance: number;
          employee_id: string;
          employee_name: string;
          line: string;
          oee: number;
          performance: number;
          product: string;
          reason: string;
          record_id: string;
          shift: string;
          work_date: string;
        }[];
      };
      downtime_pareto: {
        Args: { p_work_date_from?: string; p_work_date_to?: string };
        Returns: {
          category: string;
          occurrences: number;
          reason_label: string;
          total_minutes: number;
        }[];
      };
      ensure_import_item_product_profiles: {
        Args: { p_import_item_id: string };
        Returns: undefined;
      };
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
      evaluate_batch_ha_tup_linkage: {
        Args: { p_batch_id: string };
        Returns: Json;
      };
      find_ha_tup_link: {
        Args: {
          p_line: string;
          p_shift: string;
          p_tup_product_code: string;
          p_work_date: string;
        };
        Returns: {
          ha_import_item_id: string;
          ha_import_item_ids: string[];
          ha_product_code: string;
          match_status: string;
        }[];
      };
      ha_tup_linkage_report: {
        Args: { p_work_date_from?: string; p_work_date_to?: string };
        Returns: {
          allocation_fraction: number;
          ha_available_output: number;
          ha_product_code: string;
          hours_capped: number;
          hours_linked: number;
          linked_ha_import_item_id: string;
          shift: string;
          tup_actual_output: number;
          tup_product_code: string;
          work_date: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      historical_recompute_apply: {
        Args: { p_work_date_from?: string; p_work_date_to?: string };
        Returns: Json;
      };
      historical_recompute_preview: {
        Args: {
          p_sample_limit?: number;
          p_work_date_from?: string;
          p_work_date_to?: string;
        };
        Returns: Json;
      };
      is_tester: { Args: { p_user_id?: string }; Returns: boolean };
      isfinite: { Args: { p_value: number }; Returns: boolean };
      list_hourly_stat_review: {
        Args: { p_statuses?: string[] };
        Returns: {
          actual_oee_pct: number;
          actual_output: number;
          availability_pct: number;
          hour: number;
          hourly_id: string;
          import_item_id: string;
          line: string;
          performance_pct: number;
          product_code: string;
          reconstruction_status: string;
          shift: string;
          stat_status: string;
          trace_id: string;
          work_date: string;
        }[];
      };
      normalize_downtime_reason: { Args: { p_text: string }; Returns: string };
      recalculate_import_item_kpis: {
        Args: { p_import_item_id: string };
        Returns: undefined;
      };
      reconstruct_import_item_hourly: {
        Args: { p_import_item_id: string };
        Returns: undefined;
      };
      refresh_daily_records_for_import_item: {
        Args: { p_import_item_id: string };
        Returns: Json;
      };
      refresh_import_batch_counters: {
        Args: { p_batch_id: string };
        Returns: undefined;
      };
      repair_import_item_product_identity: {
        Args: { p_import_item_id: string };
        Returns: undefined;
      };
      resolve_product_profile: {
        Args: {
          p_allow_fallback?: boolean;
          p_code: string;
          p_work_date?: string;
        };
        Returns: {
          h_capacity: number;
          h_norm_per_hour: number;
          match_source: string;
          product_code: string;
          product_id: string;
          product_name: string;
          profile_complete: boolean;
          profile_ha_subassy: string;
          profile_id: string;
          profile_tup_subassy: string;
          t_capacity: number;
          t_norm_per_hour: number;
        }[];
      };
      run_data_integrity_audit: {
        Args: never;
        Returns: {
          check_name: string;
          sample_ids: string[];
          severity: string;
          violation_count: number;
        }[];
      };
      set_hourly_stat_status: {
        Args: {
          p_hourly_id: string;
          p_new_status: string;
          p_note?: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      start_shift_production: { Args: { p_shift_id: string }; Returns: Json };
      sync_effective_last_hour_norm: {
        Args: { p_import_item_id: string };
        Returns: undefined;
      };
      sync_import_item_hourly_from_ocr: {
        Args: { p_import_item_id: string };
        Returns: undefined;
      };
      sync_profile_pair: {
        Args: {
          p_h_capacity: number;
          p_h_norm: number;
          p_ha_code: string;
          p_name: string;
          p_t_capacity: number;
          p_t_norm: number;
          p_tup_code: string;
        };
        Returns: undefined;
      };
      sync_workplace_from_daily_record_line: {
        Args: { p_line: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "team_leader" | "operator" | "tester";
      employee_position_type: "handler" | "vlnař" | "operator" | "standard";
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
      app_role: ["admin", "team_leader", "operator", "tester"],
      employee_position_type: ["handler", "vlnař", "operator", "standard"],
    },
  },
} as const;
