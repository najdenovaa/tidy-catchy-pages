export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      analysis_logs: {
        Row: {
          created_at: string
          document_names: string[] | null
          documents_count: number | null
          id: string
          ip_address: string | null
          location: string | null
          module: string
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          well_summary: string | null
        }
        Insert: {
          created_at?: string
          document_names?: string[] | null
          documents_count?: number | null
          id?: string
          ip_address?: string | null
          location?: string | null
          module?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          well_summary?: string | null
        }
        Update: {
          created_at?: string
          document_names?: string[] | null
          documents_count?: number | null
          id?: string
          ip_address?: string | null
          location?: string | null
          module?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          well_summary?: string | null
        }
        Relationships: []
      }
      calculation_logs: {
        Row: {
          calc_params: Json | null
          created_at: string
          id: string
          ip_address: string | null
          location: string | null
          module: string
          page_url: string | null
          user_agent: string | null
          well_data: Json | null
        }
        Insert: {
          calc_params?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          location?: string | null
          module?: string
          page_url?: string | null
          user_agent?: string | null
          well_data?: Json | null
        }
        Update: {
          calc_params?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          location?: string | null
          module?: string
          page_url?: string | null
          user_agent?: string | null
          well_data?: Json | null
        }
        Relationships: []
      }
      fields: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          credits_purchased: number
          id: string
          robokassa_inv_id: string | null
          robokassa_signature: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          credits_purchased?: number
          id?: string
          robokassa_inv_id?: string | null
          robokassa_signature?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          credits_purchased?: number
          id?: string
          robokassa_inv_id?: string | null
          robokassa_signature?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_calculations: {
        Row: {
          calc_params: Json | null
          created_at: string
          id: string
          module: string
          results: Json | null
          title: string
          updated_at: string
          user_id: string
          well_data: Json | null
          well_id: string
        }
        Insert: {
          calc_params?: Json | null
          created_at?: string
          id?: string
          module?: string
          results?: Json | null
          title: string
          updated_at?: string
          user_id: string
          well_data?: Json | null
          well_id: string
        }
        Update: {
          calc_params?: Json | null
          created_at?: string
          id?: string
          module?: string
          results?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
          well_data?: Json | null
          well_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_calculations_well_id_fkey"
            columns: ["well_id"]
            isOneToOne: false
            referencedRelation: "wells"
            referencedColumns: ["id"]
          },
        ]
      }
      user_credits: {
        Row: {
          ai_analyses_limit: number
          ai_analyses_used: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_analyses_limit?: number
          ai_analyses_used?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_analyses_limit?: number
          ai_analyses_used?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visit_logs: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          location: string | null
          module: string
          page_url: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          location?: string | null
          module?: string
          page_url?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          location?: string | null
          module?: string
          page_url?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      well_pads: {
        Row: {
          created_at: string
          field_id: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "well_pads_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      wells: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
          well_pad_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
          well_pad_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
          well_pad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wells_well_pad_id_fkey"
            columns: ["well_pad_id"]
            isOneToOne: false
            referencedRelation: "well_pads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
