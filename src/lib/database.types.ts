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
  | "cancelled"
  | "follow_up_short"
  | "follow_up_long"

export type TeamRole = "admin" | "closer" | "setter" | "coach"

export type ApiKeyScope = "lead.create" | "payment.create" | "read.basic"

type Tbl<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type Vw<Row> = {
  Row: Row
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      team_members: Tbl<{
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
      }>
      leads: Tbl<{
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
        source: string | null
        booked_at: string | null
        scheduled_at: string | null
        cancelled_at: string | null
        closed_at: string | null
        budget_cents: number | null
        calendly_cancel_url: string | null
        calendly_reschedule_url: string | null
        calendly_event_id: string | null
        pre_call_started: boolean
        pre_call_started_at: string | null
        pre_call_completed_at: string | null
        created_at: string
        updated_at: string
      }>
      deals: Tbl<{
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
      }>
      students: Tbl<{
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
      }>
      activities: Tbl<{
        id: string
        lead_id: string | null
        student_id: string | null
        actor_id: string | null
        type: string
        payload: Json | null
        created_at: string
      }>
      integrations_log: Tbl<{
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
      }>
      lead_tags: Tbl<{
        id: string
        name: string
        description: string | null
        color: string
        created_by: string | null
        created_at: string
      }>
      lead_tag_assignments: Tbl<{
        lead_id: string
        tag_id: string
        assigned_by: string | null
        assigned_at: string
      }>
      payments: Tbl<{
        id: string
        lead_id: string | null
        deal_id: string | null
        amount_cents: number
        currency: string
        paid_at: string
        stripe_charge_id: string | null
        stripe_payment_intent_id: string | null
        source: string
        is_refund: boolean
        notes: string | null
        created_at: string
      }>
      imports: Tbl<{
        id: string
        kind: "leads" | "payments"
        filename: string | null
        storage_path: string | null
        status: "pending" | "processing" | "complete" | "failed"
        total_rows: number
        imported_rows: number
        skipped_rows: number
        error_rows: number
        started_by: string | null
        error_message: string | null
        created_at: string
        finished_at: string | null
      }>
      integration_configs: Tbl<{
        id: string
        provider: string
        is_connected: boolean
        display_name: string | null
        config: Json
        secret_ref: string | null
        connected_by: string | null
        connected_at: string | null
        last_synced_at: string | null
        created_at: string
        updated_at: string
      }>
      sops: Tbl<{
        id: string
        category: string
        title: string
        body_md: string
        visible_to: TeamRole[]
        version: number
        is_archived: boolean
        created_by: string | null
        updated_by: string | null
        created_at: string
        updated_at: string
      }>
      call_outcomes: Tbl<{
        id: string
        lead_id: string
        closer_id: string | null
        scheduled_for: string | null
        occurred_at: string | null
        result: "showed" | "no_show" | "pitched" | "closed" | "lost" | "rescheduled"
        reason: string | null
        notes: string | null
        created_at: string
      }>
      reminders: Tbl<{
        id: string
        lead_id: string | null
        team_member_id: string | null
        kind: string
        fire_at: string
        status: "scheduled" | "sent" | "cancelled" | "failed"
        payload: Json | null
        created_at: string
        completed_at: string | null
      }>
      notifications: Tbl<{
        id: string
        recipient_id: string
        kind: string
        title: string
        body: string | null
        link: string | null
        related_lead_id: string | null
        related_student_id: string | null
        read_at: string | null
        created_at: string
      }>
      webhook_subscriptions: Tbl<
        {
          id: string
          name: string
          target_url: string
          event_types: string[]
          signing_secret: string | null
          is_active: boolean
          description: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          last_delivered_at: string | null
          last_status: "success" | "failed" | null
        },
        {
          name: string
          target_url: string
          event_types: string[]
          signing_secret?: string | null
          is_active?: boolean
          description?: string | null
        }
      >
      webhook_deliveries: Tbl<
        {
          id: string
          subscription_id: string
          event_type: string
          event_id: string
          payload: Json
          status: "pending" | "success" | "failed"
          attempts: number
          response_status: number | null
          response_body_preview: string | null
          error: string | null
          created_at: string
          delivered_at: string | null
        },
        {
          subscription_id: string
          event_type: string
          event_id: string
          payload: Json
          status: "pending" | "success" | "failed"
          attempts?: number
          response_status?: number | null
          response_body_preview?: string | null
          error?: string | null
          delivered_at?: string | null
        }
      >
      automation_settings: Tbl<{
        key: string
        display_name: string
        description: string | null
        enabled: boolean
        updated_at: string
        updated_by: string | null
      }>
      api_keys: Tbl<
        {
          id: string
          name: string
          prefix: string
          hashed_key: string
          scopes: ApiKeyScope[]
          created_by: string | null
          created_at: string
          last_used_at: string | null
          last_used_ip: string | null
          revoked_at: string | null
          expires_at: string | null
        },
        {
          name: string
          prefix: string
          hashed_key: string
          scopes?: ApiKeyScope[]
          created_by?: string | null
          expires_at?: string | null
        }
      >
    }
    Views: {
      api_keys_safe_v: Vw<{
        id: string
        name: string
        prefix: string
        scopes: ApiKeyScope[]
        created_by: string | null
        created_at: string
        last_used_at: string | null
        last_used_ip: string | null
        revoked_at: string | null
        expires_at: string | null
        status: "active" | "revoked"
      }>
      kpi_snapshot_v: Vw<{
        cash_collected_cents: number
        order_value_cents: number
        calls_booked: number
        show_up_rate_pct: number
        conversion_rate_pct: number
        cancel_rate_pct: number
        avg_order_per_call_cents: number
        avg_order_per_close_cents: number
      }>
      daily_metrics_v: Vw<{
        day: string
        cash_collected_cents: number
        refunds_cents: number
        calls_booked: number
        order_value_cents: number
        wins: number
        losses: number
      }>
      closer_performance_v: Vw<{
        closer_id: string
        full_name: string
        calls_booked: number
        calls_showed: number
        calls_pitched: number
        deals_won: number
        deals_lost: number
        cash_collected_cents: number
        show_rate_pct: number
        close_rate_pct: number
      }>
      setter_performance_v: Vw<{
        setter_id: string
        full_name: string
        bookings_made: number
        bookings_to_sale: number
        conversion_rate_pct: number
      }>
      lead_funnel_v: Vw<{
        lead_id: string
        created_at: string
        stage: LeadStage
        closer_id: string | null
        setter_id: string | null
        did_show: boolean
        was_pitched: boolean
        is_won: boolean
        cash_collected_cents: number
      }>
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
