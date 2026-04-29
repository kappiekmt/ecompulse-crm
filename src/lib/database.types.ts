export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type LeadStage =
  | "new"
  | "booked"
  | "confirmed"
  | "showed"
  | "no_show"
  | "pitched"
  | "won"
  | "lost"
  | "onboarding"
  | "active_student"
  | "churned"
  | "refunded"

export type TeamRole = "admin" | "closer" | "setter" | "coach"

export interface Database {
  public: {
    Tables: {
      team_members: {
        Row: {
          id: string
          user_id: string | null
          full_name: string
          email: string
          role: TeamRole
          slack_user_id: string | null
          timezone: string | null
          commission_pct: number | null
          capacity: number | null
          is_active: boolean
          created_at: string
        }
        Insert: Omit<
          Database["public"]["Tables"]["team_members"]["Row"],
          "id" | "created_at" | "is_active"
        > & { id?: string; created_at?: string; is_active?: boolean }
        Update: Partial<Database["public"]["Tables"]["team_members"]["Insert"]>
      }
      leads: {
        Row: {
          id: string
          full_name: string
          email: string | null
          phone: string | null
          instagram: string | null
          timezone: string | null
          stage: LeadStage
          closer_id: string | null
          setter_id: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_term: string | null
          source_landing_page: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["leads"]["Row"]> & {
          full_name: string
        }
        Update: Partial<Database["public"]["Tables"]["leads"]["Row"]>
      }
      deals: {
        Row: {
          id: string
          lead_id: string
          program: string
          amount_cents: number
          currency: string
          payment_plan: Json | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          stripe_payment_intent_id: string | null
          status: "open" | "won" | "lost" | "refunded"
          lost_reason: string | null
          closed_at: string | null
          created_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["deals"]["Row"]> & {
          lead_id: string
          program: string
          amount_cents: number
        }
        Update: Partial<Database["public"]["Tables"]["deals"]["Row"]>
      }
      students: {
        Row: {
          id: string
          lead_id: string
          deal_id: string
          coach_id: string | null
          program: string
          discord_user_id: string | null
          whop_membership_id: string | null
          onboarding_status: "pending" | "in_progress" | "complete"
          onboarding_checklist: Json | null
          enrolled_at: string
          updated_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["students"]["Row"]> & {
          lead_id: string
          deal_id: string
          program: string
        }
        Update: Partial<Database["public"]["Tables"]["students"]["Row"]>
      }
      activities: {
        Row: {
          id: string
          lead_id: string | null
          student_id: string | null
          actor_id: string | null
          type: string
          payload: Json | null
          created_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["activities"]["Row"]> & {
          type: string
        }
        Update: Partial<Database["public"]["Tables"]["activities"]["Row"]>
      }
      integrations_log: {
        Row: {
          id: string
          provider: string
          direction: "inbound" | "outbound"
          event_type: string
          status: "pending" | "success" | "failed" | "retrying"
          request_payload: Json | null
          response_payload: Json | null
          error: string | null
          retry_count: number
          related_lead_id: string | null
          created_at: string
        }
        Insert: Partial<Database["public"]["Tables"]["integrations_log"]["Row"]> & {
          provider: string
          direction: "inbound" | "outbound"
          event_type: string
          status: "pending" | "success" | "failed" | "retrying"
        }
        Update: Partial<Database["public"]["Tables"]["integrations_log"]["Row"]>
      }
    }
  }
}
