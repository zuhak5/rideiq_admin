/* eslint-disable */
// Auto-generated from supabase/schema.sql. Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Enums: {
      admin_audit_action: 'grant_admin' | 'revoke_admin';
      app_event_level: 'info' | 'warn' | 'error';
      cash_collection_status: 'reported' | 'verified' | 'void';
      chat_message_type: 'text' | 'ai' | 'image' | 'system';
      contact_channel: 'sms' | 'webhook';
      delivery_actor_role: 'admin' | 'driver' | 'merchant';
      device_platform: 'android' | 'ios' | 'web';
      driver_rank_period: 'weekly' | 'monthly';
      driver_status: 'offline' | 'available' | 'on_trip' | 'suspended' | 'reserved' | 'assigned';
      driver_vehicle_type: 'car_private' | 'car_taxi' | 'motorcycle' | 'cargo';
      family_member_role: 'guardian' | 'teen' | 'adult';
      family_member_status: 'invited' | 'active' | 'suspended';
      fraud_case_status: 'open' | 'closed';
      fraud_subject_kind: 'user' | 'driver' | 'device' | 'ip_prefix';
      gender_identity: 'female' | 'male' | 'nonbinary' | 'undisclosed';
      gender_visibility: 'hidden' | 'shown_to_matches';
      incident_severity: 'low' | 'medium' | 'high' | 'critical';
      incident_status: 'open' | 'triaging' | 'resolved' | 'closed';
      kyc_document_status: 'pending' | 'approved' | 'rejected';
      kyc_liveness_status: 'started' | 'passed' | 'failed' | 'expired';
      kyc_role_required: 'rider' | 'driver' | 'both';
      kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected';
      kyc_submission_status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'resubmit_required';
      live_activity_platform: 'ios' | 'android';
      membership_status: 'active' | 'cancelled' | 'expired' | 'paused';
      merchant_chat_auto_reply_mode: 'smart' | 'always';
      merchant_order_delivery_status: 'requested' | 'assigned' | 'picked_up' | 'delivered' | 'cancelled';
      merchant_order_payment_method: 'wallet' | 'cod';
      merchant_order_payment_status: 'unpaid' | 'paid_wallet' | 'collected_cod';
      merchant_order_status: 'placed' | 'accepted' | 'preparing' | 'out_for_delivery' | 'fulfilled' | 'cancelled';
      merchant_promotion_discount_type: 'percent' | 'fixed_iqd';
      merchant_status: 'draft' | 'pending' | 'approved' | 'suspended';
      message_direction: 'in' | 'out';
      order_bundle_status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
      outbox_status: 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
      party_role: 'rider' | 'driver';
      passkey_status: 'active' | 'revoked';
      passkey_type: 'platform' | 'cross_platform';
      payment_intent_status: 'requires_payment_method' | 'requires_confirmation' | 'requires_capture' | 'succeeded' | 'failed' | 'canceled' | 'refunded';
      payment_provider_kind: 'zaincash' | 'asiapay' | 'qicard' | 'manual';
      payment_status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'refunded';
      payout_attempt_status: 'created' | 'sent' | 'succeeded' | 'failed';
      payout_provider_job_attempt_status: 'sending' | 'sent' | 'failed' | 'confirmed';
      payout_provider_job_status: 'queued' | 'sent' | 'confirmed' | 'failed' | 'canceled';
      pin_verification_mode: 'off' | 'every_ride' | 'night_only';
      referral_invite_status: 'pending' | 'qualified' | 'rewarded' | 'canceled';
      referral_redemption_status: 'pending' | 'rewarded' | 'invalid';
      ride_actor_type: 'rider' | 'driver' | 'system';
      ride_intent_source: 'callcenter';
      ride_intent_status: 'new' | 'converted' | 'closed';
      ride_payment_method: 'wallet' | 'cash';
      ride_payment_status: 'unpaid' | 'authorized' | 'captured' | 'refunded' | 'collected_cash';
      ride_receipt_status: 'paid' | 'partially_refunded' | 'refunded';
      ride_request_status: 'requested' | 'matched' | 'accepted' | 'cancelled' | 'no_driver' | 'expired';
      ride_status: 'assigned' | 'arrived' | 'in_progress' | 'completed' | 'canceled';
      ridecheck_event_status: 'open' | 'resolved' | 'escalated';
      ridecheck_kind: 'gps_stale' | 'long_stop' | 'route_deviation' | 'generic';
      ridecheck_response: 'ok' | 'false_alarm' | 'need_help';
      scheduled_ride_status: 'pending' | 'cancelled' | 'executed' | 'failed';
      settlement_party_type: 'driver' | 'merchant';
      settlement_request_status: 'requested' | 'approved' | 'rejected' | 'cancelled';
      shift_status: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';
      sms_hook_status: 'sent' | 'failed';
      sos_event_status: 'triggered' | 'resolved' | 'canceled';
      support_ticket_priority: 'low' | 'normal' | 'high';
      support_ticket_status: 'open' | 'pending' | 'resolved' | 'closed';
      topup_status: 'created' | 'pending' | 'succeeded' | 'failed';
      trip_live_status: 'driver_assigned' | 'driver_arriving' | 'driver_arrived' | 'trip_started' | 'trip_paused' | 'near_destination' | 'trip_completed' | 'trip_cancelled';
      trusted_contact_event_status: 'ok' | 'queued' | 'sent' | 'failed' | 'skipped';
      user_gender: 'male' | 'female' | 'unknown';
      user_interest_target_kind: 'merchant' | 'product' | 'category' | 'keyword';
      user_role: 'rider' | 'driver' | 'merchant';
      voice_call_participant_role: 'rider' | 'driver' | 'business';
      voice_call_provider: 'agora' | 'daily';
      voice_call_status: 'created' | 'ringing' | 'active' | 'ended' | 'missed' | 'canceled' | 'failed';
      wallet_entry_kind: 'topup' | 'ride_fare' | 'withdrawal' | 'adjustment';
      wallet_hold_kind: 'ride' | 'withdraw';
      wallet_hold_status: 'active' | 'captured' | 'released' | 'held';
      webhook_job_status: 'queued' | 'failed' | 'succeeded' | 'dead';
      withdraw_payout_kind: 'qicard' | 'asiapay' | 'zaincash';
      withdraw_request_status: 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled';
    };
    Tables: {
      achievement_progress: {
        Row: {
          achievement_id: string;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          id: string;
          progress: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          achievement_id?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          progress?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          achievement_id?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          progress?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      achievements: {
        Row: {
          active: boolean;
          badge_icon: string | null;
          created_at: string;
          description: string | null;
          id: string;
          key: string;
          metric: string;
          reward_iqd: number;
          role: Database['public']['Enums']['party_role'];
          sort_order: number;
          target: number;
          title: string;
        };
        Insert: {
          active?: boolean;
          badge_icon?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          key?: string;
          metric?: string;
          reward_iqd?: number;
          role?: Database['public']['Enums']['party_role'];
          sort_order?: number;
          target?: number;
          title?: string;
        };
        Update: {
          active?: boolean;
          badge_icon?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          key?: string;
          metric?: string;
          reward_iqd?: number;
          role?: Database['public']['Enums']['party_role'];
          sort_order?: number;
          target?: number;
          title?: string;
        };
        Relationships: [];
      };
      addon_offers: {
        Row: {
          converted_at: string | null;
          created_at: string;
          dismissed_at: string | null;
          eligible_merchants: Json;
          expires_at: string;
          id: string;
          order_id: string;
          viewed_at: string | null;
        };
        Insert: {
          converted_at?: string | null;
          created_at?: string;
          dismissed_at?: string | null;
          eligible_merchants?: Json;
          expires_at?: string;
          id?: string;
          order_id?: string;
          viewed_at?: string | null;
        };
        Update: {
          converted_at?: string | null;
          created_at?: string;
          dismissed_at?: string | null;
          eligible_merchants?: Json;
          expires_at?: string;
          id?: string;
          order_id?: string;
          viewed_at?: string | null;
        };
        Relationships: [];
      };
      admin_action_throttle: {
        Row: {
          action_key: string;
          bucket_start: string;
          count: number;
          user_id: string;
        };
        Insert: {
          action_key?: string;
          bucket_start?: string;
          count?: number;
          user_id?: string;
        };
        Update: {
          action_key?: string;
          bucket_start?: string;
          count?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      admin_audit_log: {
        Row: {
          action: Database['public']['Enums']['admin_audit_action'];
          actor_id: string;
          created_at: string;
          details: Json | null;
          id: number;
          note: string | null;
          target_user_id: string;
        };
        Insert: {
          action?: Database['public']['Enums']['admin_audit_action'];
          actor_id?: string;
          created_at?: string;
          details?: Json | null;
          id?: number;
          note?: string | null;
          target_user_id?: string;
        };
        Update: {
          action?: Database['public']['Enums']['admin_audit_action'];
          actor_id?: string;
          created_at?: string;
          details?: Json | null;
          id?: number;
          note?: string | null;
          target_user_id?: string;
        };
        Relationships: [];
      };
      admin_permissions: {
        Row: {
          created_at: string;
          description: string | null;
          id: number | null;
          key: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: number | null;
          key?: string;
          name?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: number | null;
          key?: string;
          name?: string;
        };
        Relationships: [];
      };
      admin_role_change_requests: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          created_by: string;
          executed_at: string | null;
          executed_by: string | null;
          id: string | null;
          note: string | null;
          requested_role_keys: string[];
          status: string;
          target_user_id: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string;
          executed_at?: string | null;
          executed_by?: string | null;
          id?: string | null;
          note?: string | null;
          requested_role_keys?: string[];
          status?: string;
          target_user_id?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string;
          executed_at?: string | null;
          executed_by?: string | null;
          id?: string | null;
          note?: string | null;
          requested_role_keys?: string[];
          status?: string;
          target_user_id?: string;
        };
        Relationships: [];
      };
      admin_role_permissions: {
        Row: {
          created_at: string;
          permission_id: number;
          role_id: number;
        };
        Insert: {
          created_at?: string;
          permission_id?: number;
          role_id?: number;
        };
        Update: {
          created_at?: string;
          permission_id?: number;
          role_id?: number;
        };
        Relationships: [];
      };
      admin_roles: {
        Row: {
          created_at: string;
          description: string | null;
          id: number | null;
          key: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: number | null;
          key?: string;
          name?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: number | null;
          key?: string;
          name?: string;
        };
        Relationships: [];
      };
      admin_user_roles: {
        Row: {
          created_at: string;
          granted_by: string | null;
          note: string | null;
          role_id: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          note?: string | null;
          role_id?: number;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          note?: string | null;
          role_id?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      admin_users: {
        Row: {
          created_at: string;
          created_by: string | null;
          note: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          note?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          note?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      agent_daily_counters: {
        Row: {
          agent_id: string;
          day: string;
          next_payout_seq: number;
          next_receipt_seq: number;
          updated_at: string;
        };
        Insert: {
          agent_id?: string;
          day?: string;
          next_payout_seq?: number;
          next_receipt_seq?: number;
          updated_at?: string;
        };
        Update: {
          agent_id?: string;
          day?: string;
          next_payout_seq?: number;
          next_receipt_seq?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      api_rate_limits: {
        Row: {
          count: number;
          key: string;
          window_seconds: number;
          window_start: string;
        };
        Insert: {
          count?: number;
          key?: string;
          window_seconds?: number;
          window_start?: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_seconds?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      app_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database['public']['Enums']['ride_actor_type'] | null;
          created_at: string;
          event_type: string;
          id: string;
          level: Database['public']['Enums']['app_event_level'];
          payload: Json;
          payment_intent_id: string | null;
          request_id: string | null;
          ride_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          actor_type?: Database['public']['Enums']['ride_actor_type'] | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          level?: Database['public']['Enums']['app_event_level'];
          payload?: Json;
          payment_intent_id?: string | null;
          request_id?: string | null;
          ride_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database['public']['Enums']['ride_actor_type'] | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          level?: Database['public']['Enums']['app_event_level'];
          payload?: Json;
          payment_intent_id?: string | null;
          request_id?: string | null;
          ride_id?: string | null;
        };
        Relationships: [];
      };
      auth_sms_hook_events: {
        Row: {
          created_at: string;
          error: string | null;
          otp_hash: string | null;
          phone_e164: string | null;
          provider_used: string | null;
          status: Database['public']['Enums']['sms_hook_status'];
          user_id: string | null;
          webhook_id: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          otp_hash?: string | null;
          phone_e164?: string | null;
          provider_used?: string | null;
          status?: Database['public']['Enums']['sms_hook_status'];
          user_id?: string | null;
          webhook_id?: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          otp_hash?: string | null;
          phone_e164?: string | null;
          provider_used?: string | null;
          status?: Database['public']['Enums']['sms_hook_status'];
          user_id?: string | null;
          webhook_id?: string;
        };
        Relationships: [];
      };
      cash_agents: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          is_active: boolean;
          location: string | null;
          name: string;
        };
        Insert: {
          code?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          location?: string | null;
          name?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          location?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      cash_collections: {
        Row: {
          change_given_iqd: number;
          collected_amount_iqd: number;
          created_at: string;
          expected_amount_iqd: number;
          reported_by: string;
          ride_id: string;
          status: Database['public']['Enums']['cash_collection_status'];
          updated_at: string;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          change_given_iqd?: number;
          collected_amount_iqd?: number;
          created_at?: string;
          expected_amount_iqd?: number;
          reported_by?: string;
          ride_id?: string;
          status?: Database['public']['Enums']['cash_collection_status'];
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          change_given_iqd?: number;
          collected_amount_iqd?: number;
          created_at?: string;
          expected_amount_iqd?: number;
          reported_by?: string;
          ride_id?: string;
          status?: Database['public']['Enums']['cash_collection_status'];
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [];
      };
      cashbox_daily_closings: {
        Row: {
          agent_id: string;
          closed_at: string;
          closed_by: string;
          counted_cash_iqd: number;
          created_at: string;
          day: string;
          expected_net_iqd: number;
          id: string;
          idempotency_key: string | null;
          note: string | null;
          variance_iqd: number;
        };
        Insert: {
          agent_id?: string;
          closed_at?: string;
          closed_by?: string;
          counted_cash_iqd?: number;
          created_at?: string;
          day?: string;
          expected_net_iqd?: number;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          variance_iqd?: number;
        };
        Update: {
          agent_id?: string;
          closed_at?: string;
          closed_by?: string;
          counted_cash_iqd?: number;
          created_at?: string;
          day?: string;
          expected_net_iqd?: number;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          variance_iqd?: number;
        };
        Relationships: [];
      };
      concierge_feedback: {
        Row: {
          comment: string | null;
          created_at: string;
          feedback_type: string | null;
          id: string;
          rating: number | null;
          session_id: string;
          user_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          feedback_type?: string | null;
          id?: string;
          rating?: number | null;
          session_id?: string;
          user_id?: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          feedback_type?: string | null;
          id?: string;
          rating?: number | null;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      concierge_sessions: {
        Row: {
          created_at: string;
          expires_at: string;
          history: Json;
          id: string;
          merchant_id: string | null;
          mode: string;
          preferences: Json;
          selected_items: Json | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          history?: Json;
          id?: string;
          merchant_id?: string | null;
          mode?: string;
          preferences?: Json;
          selected_items?: Json | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          history?: Json;
          id?: string;
          merchant_id?: string | null;
          mode?: string;
          preferences?: Json;
          selected_items?: Json | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      customer_addresses: {
        Row: {
          address_line1: string;
          address_line2: string | null;
          area: string | null;
          city: string;
          created_at: string;
          id: string;
          is_default: boolean;
          label: string | null;
          loc: unknown | null;
          notes: string | null;
          phone: string | null;
          recipient_name: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address_line1?: string;
          address_line2?: string | null;
          area?: string | null;
          city?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          loc?: unknown | null;
          notes?: string | null;
          phone?: string | null;
          recipient_name?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          address_line1?: string;
          address_line2?: string | null;
          area?: string | null;
          city?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          loc?: unknown | null;
          notes?: string | null;
          phone?: string | null;
          recipient_name?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      demand_hotspots: {
        Row: {
          center_lat: number;
          center_lng: number;
          created_at: string;
          demand_level: number;
          expected_wait_minutes: number | null;
          id: string;
          nearby_driver_count: number | null;
          radius_m: number;
          surge_multiplier: number | null;
          trips_last_hour: number | null;
          valid_until: string;
          zone_id: string;
          zone_name: string;
        };
        Insert: {
          center_lat?: number;
          center_lng?: number;
          created_at?: string;
          demand_level?: number;
          expected_wait_minutes?: number | null;
          id?: string;
          nearby_driver_count?: number | null;
          radius_m?: number;
          surge_multiplier?: number | null;
          trips_last_hour?: number | null;
          valid_until?: string;
          zone_id?: string;
          zone_name?: string;
        };
        Update: {
          center_lat?: number;
          center_lng?: number;
          created_at?: string;
          demand_level?: number;
          expected_wait_minutes?: number | null;
          id?: string;
          nearby_driver_count?: number | null;
          radius_m?: number;
          surge_multiplier?: number | null;
          trips_last_hour?: number | null;
          valid_until?: string;
          zone_id?: string;
          zone_name?: string;
        };
        Relationships: [];
      };
      device_tokens: {
        Row: {
          created_at: string;
          disabled_at: string | null;
          enabled: boolean;
          id: number;
          last_seen_at: string;
          platform: Database['public']['Enums']['device_platform'];
          token: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          disabled_at?: string | null;
          enabled?: boolean;
          id?: number;
          last_seen_at?: string;
          platform?: Database['public']['Enums']['device_platform'];
          token?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          disabled_at?: string | null;
          enabled?: boolean;
          id?: number;
          last_seen_at?: string;
          platform?: Database['public']['Enums']['device_platform'];
          token?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      driver_coaching_tips: {
        Row: {
          acted_at: string | null;
          action_url: string | null;
          created_at: string;
          dismissed_at: string | null;
          driver_id: string;
          expires_at: string | null;
          id: string;
          message: string;
          priority: number;
          tip_type: string;
          title: string;
          variant: string | null;
          viewed_at: string | null;
        };
        Insert: {
          acted_at?: string | null;
          action_url?: string | null;
          created_at?: string;
          dismissed_at?: string | null;
          driver_id?: string;
          expires_at?: string | null;
          id?: string;
          message?: string;
          priority?: number;
          tip_type?: string;
          title?: string;
          variant?: string | null;
          viewed_at?: string | null;
        };
        Update: {
          acted_at?: string | null;
          action_url?: string | null;
          created_at?: string;
          dismissed_at?: string | null;
          driver_id?: string;
          expires_at?: string | null;
          id?: string;
          message?: string;
          priority?: number;
          tip_type?: string;
          title?: string;
          variant?: string | null;
          viewed_at?: string | null;
        };
        Relationships: [];
      };
      driver_counters: {
        Row: {
          completed_rides: number;
          driver_id: string;
          earnings_iqd: number;
          updated_at: string;
        };
        Insert: {
          completed_rides?: number;
          driver_id?: string;
          earnings_iqd?: number;
          updated_at?: string;
        };
        Update: {
          completed_rides?: number;
          driver_id?: string;
          earnings_iqd?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_leaderboard_daily: {
        Row: {
          created_at: string;
          day: string;
          driver_id: string;
          earnings_iqd: number;
          rank: number | null;
          score: number;
          trips_count: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          day?: string;
          driver_id?: string;
          earnings_iqd?: number;
          rank?: number | null;
          score?: number;
          trips_count?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          day?: string;
          driver_id?: string;
          earnings_iqd?: number;
          rank?: number | null;
          score?: number;
          trips_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_locations: {
        Row: {
          accuracy_m: number | null;
          driver_id: string;
          heading: number | null;
          lat: number;
          lng: number;
          loc: unknown | null;
          speed_mps: number | null;
          updated_at: string;
          vehicle_type: string | null;
        };
        Insert: {
          accuracy_m?: number | null;
          driver_id?: string;
          heading?: number | null;
          lat?: number;
          lng?: number;
          loc?: unknown | null;
          speed_mps?: number | null;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Update: {
          accuracy_m?: number | null;
          driver_id?: string;
          heading?: number | null;
          lat?: number;
          lng?: number;
          loc?: unknown | null;
          speed_mps?: number | null;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      driver_rank_snapshots: {
        Row: {
          created_at: string;
          driver_id: string;
          earnings_iqd: number | null;
          id: string;
          period: Database['public']['Enums']['driver_rank_period'];
          period_end: string;
          period_start: string;
          rank: number;
          rides_completed: number;
          score: number | null;
          score_iqd: number;
        };
        Insert: {
          created_at?: string;
          driver_id?: string;
          earnings_iqd?: number | null;
          id?: string;
          period?: Database['public']['Enums']['driver_rank_period'];
          period_end?: string;
          period_start?: string;
          rank?: number;
          rides_completed?: number;
          score?: number | null;
          score_iqd?: number;
        };
        Update: {
          created_at?: string;
          driver_id?: string;
          earnings_iqd?: number | null;
          id?: string;
          period?: Database['public']['Enums']['driver_rank_period'];
          period_end?: string;
          period_start?: string;
          rank?: number;
          rides_completed?: number;
          score?: number | null;
          score_iqd?: number;
        };
        Relationships: [];
      };
      driver_shifts: {
        Row: {
          actual_end: string | null;
          actual_start: string | null;
          created_at: string;
          driver_id: string;
          id: string;
          notes: string | null;
          preferred_zones: string[] | null;
          reminder_minutes_before: number;
          reminder_sent_at: string | null;
          scheduled_end: string;
          scheduled_start: string;
          status: Database['public']['Enums']['shift_status'];
          target_earnings_iqd: number | null;
          target_trips: number | null;
          updated_at: string;
        };
        Insert: {
          actual_end?: string | null;
          actual_start?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          notes?: string | null;
          preferred_zones?: string[] | null;
          reminder_minutes_before?: number;
          reminder_sent_at?: string | null;
          scheduled_end?: string;
          scheduled_start?: string;
          status?: Database['public']['Enums']['shift_status'];
          target_earnings_iqd?: number | null;
          target_trips?: number | null;
          updated_at?: string;
        };
        Update: {
          actual_end?: string | null;
          actual_start?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          notes?: string | null;
          preferred_zones?: string[] | null;
          reminder_minutes_before?: number;
          reminder_sent_at?: string | null;
          scheduled_end?: string;
          scheduled_start?: string;
          status?: Database['public']['Enums']['shift_status'];
          target_earnings_iqd?: number | null;
          target_trips?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_stats_daily: {
        Row: {
          created_at: string | null;
          day: string;
          driver_id: string;
          earnings_iqd: number;
          rides_completed: number;
          trips_count: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string | null;
          day?: string;
          driver_id?: string;
          earnings_iqd?: number;
          rides_completed?: number;
          trips_count?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string | null;
          day?: string;
          driver_id?: string;
          earnings_iqd?: number;
          rides_completed?: number;
          trips_count?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_status_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          driver_id: string;
          from_status: Database['public']['Enums']['driver_status'];
          id: number;
          reason: string | null;
          to_status: Database['public']['Enums']['driver_status'];
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          driver_id?: string;
          from_status?: Database['public']['Enums']['driver_status'];
          id?: number;
          reason?: string | null;
          to_status?: Database['public']['Enums']['driver_status'];
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          driver_id?: string;
          from_status?: Database['public']['Enums']['driver_status'];
          id?: number;
          reason?: string | null;
          to_status?: Database['public']['Enums']['driver_status'];
        };
        Relationships: [];
      };
      driver_vehicles: {
        Row: {
          capacity: number | null;
          color: string | null;
          created_at: string;
          driver_id: string;
          id: string;
          is_active: boolean;
          make: string | null;
          model: string | null;
          plate_number: string | null;
          updated_at: string;
          vehicle_type: string | null;
        };
        Insert: {
          capacity?: number | null;
          color?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          is_active?: boolean;
          make?: string | null;
          model?: string | null;
          plate_number?: string | null;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Update: {
          capacity?: number | null;
          color?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          is_active?: boolean;
          make?: string | null;
          model?: string | null;
          plate_number?: string | null;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          cash_enabled: boolean;
          cash_exposure_limit_iqd: number;
          created_at: string;
          id: string;
          rating_avg: number;
          rating_count: number;
          require_pickup_pin: boolean;
          status: Database['public']['Enums']['driver_status'];
          trips_count: number;
          updated_at: string;
          vehicle_type: string | null;
        };
        Insert: {
          cash_enabled?: boolean;
          cash_exposure_limit_iqd?: number;
          created_at?: string;
          id?: string;
          rating_avg?: number;
          rating_count?: number;
          require_pickup_pin?: boolean;
          status?: Database['public']['Enums']['driver_status'];
          trips_count?: number;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Update: {
          cash_enabled?: boolean;
          cash_exposure_limit_iqd?: number;
          created_at?: string;
          id?: string;
          rating_avg?: number;
          rating_count?: number;
          require_pickup_pin?: boolean;
          status?: Database['public']['Enums']['driver_status'];
          trips_count?: number;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      earnings_coach_sessions: {
        Row: {
          created_at: string;
          driver_id: string;
          earnings_context: Json | null;
          history: Json;
          id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          driver_id?: string;
          earnings_context?: Json | null;
          history?: Json;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          driver_id?: string;
          earnings_context?: Json | null;
          history?: Json;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      earnings_forecasts: {
        Row: {
          confidence_pct: number;
          created_at: string;
          expected_earnings_iqd: number;
          expected_trips: number;
          forecast_date: string;
          hour_of_day: number;
          id: string;
          same_hour_last_week_iqd: number | null;
          zone_id: string;
        };
        Insert: {
          confidence_pct?: number;
          created_at?: string;
          expected_earnings_iqd?: number;
          expected_trips?: number;
          forecast_date?: string;
          hour_of_day?: number;
          id?: string;
          same_hour_last_week_iqd?: number | null;
          zone_id?: string;
        };
        Update: {
          confidence_pct?: number;
          created_at?: string;
          expected_earnings_iqd?: number;
          expected_trips?: number;
          forecast_date?: string;
          hour_of_day?: number;
          id?: string;
          same_hour_last_week_iqd?: number | null;
          zone_id?: string;
        };
        Relationships: [];
      };
      edge_webhook_outbox: {
        Row: {
          attempts: number;
          created_at: string;
          function_name: string;
          id: number;
          last_dispatched_at: string | null;
          last_error: string | null;
          last_http_status: number | null;
          lock_id: string | null;
          locked_at: string | null;
          next_attempt_at: string;
          payload: Json;
          secret_name: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          function_name?: string;
          id?: number;
          last_dispatched_at?: string | null;
          last_error?: string | null;
          last_http_status?: number | null;
          lock_id?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          secret_name?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          function_name?: string;
          id?: number;
          last_dispatched_at?: string | null;
          last_error?: string | null;
          last_http_status?: number | null;
          lock_id?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          secret_name?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      families: {
        Row: {
          created_at: string;
          created_by_user_id: string;
          id: string;
          name: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_user_id?: string;
          id?: string;
          name?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string;
          id?: string;
          name?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      family_members: {
        Row: {
          created_at: string;
          family_id: string;
          id: string;
          invite_email: string | null;
          invite_expires_at: string | null;
          invite_token_hash: string | null;
          joined_at: string | null;
          role: Database['public']['Enums']['family_member_role'];
          status: Database['public']['Enums']['family_member_status'];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          family_id?: string;
          id?: string;
          invite_email?: string | null;
          invite_expires_at?: string | null;
          invite_token_hash?: string | null;
          joined_at?: string | null;
          role?: Database['public']['Enums']['family_member_role'];
          status?: Database['public']['Enums']['family_member_status'];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          family_id?: string;
          id?: string;
          invite_email?: string | null;
          invite_expires_at?: string | null;
          invite_token_hash?: string | null;
          joined_at?: string | null;
          role?: Database['public']['Enums']['family_member_role'];
          status?: Database['public']['Enums']['family_member_status'];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      fare_quotes: {
        Row: {
          breakdown: Json;
          cash_rounding_step_iqd: number | null;
          context: Json;
          created_at: string;
          currency: string;
          dropoff_lat: number;
          dropoff_lng: number;
          engine: string;
          id: string;
          pickup_lat: number;
          pickup_lng: number;
          pricing_config_id: string | null;
          pricing_snapshot: Json;
          product_code: string;
          rider_id: string;
          route_distance_m: number | null;
          route_duration_s: number | null;
          route_fetched_at: string;
          route_profile: string;
          route_provider: string;
          service_area_governorate: string | null;
          service_area_id: string | null;
          service_area_name: string | null;
          total_iqd: number;
          weather: Json;
        };
        Insert: {
          breakdown?: Json;
          cash_rounding_step_iqd?: number | null;
          context?: Json;
          created_at?: string;
          currency?: string;
          dropoff_lat?: number;
          dropoff_lng?: number;
          engine?: string;
          id?: string;
          pickup_lat?: number;
          pickup_lng?: number;
          pricing_config_id?: string | null;
          pricing_snapshot?: Json;
          product_code?: string;
          rider_id?: string;
          route_distance_m?: number | null;
          route_duration_s?: number | null;
          route_fetched_at?: string;
          route_profile?: string;
          route_provider?: string;
          service_area_governorate?: string | null;
          service_area_id?: string | null;
          service_area_name?: string | null;
          total_iqd?: number;
          weather?: Json;
        };
        Update: {
          breakdown?: Json;
          cash_rounding_step_iqd?: number | null;
          context?: Json;
          created_at?: string;
          currency?: string;
          dropoff_lat?: number;
          dropoff_lng?: number;
          engine?: string;
          id?: string;
          pickup_lat?: number;
          pickup_lng?: number;
          pricing_config_id?: string | null;
          pricing_snapshot?: Json;
          product_code?: string;
          rider_id?: string;
          route_distance_m?: number | null;
          route_duration_s?: number | null;
          route_fetched_at?: string;
          route_profile?: string;
          route_provider?: string;
          service_area_governorate?: string | null;
          service_area_id?: string | null;
          service_area_name?: string | null;
          total_iqd?: number;
          weather?: Json;
        };
        Relationships: [];
      };
      fee_disclosures: {
        Row: {
          explanation: string;
          fee_type: string;
          id: string;
          locale: string;
          title: string;
        };
        Insert: {
          explanation?: string;
          fee_type?: string;
          id?: string;
          locale?: string;
          title?: string;
        };
        Update: {
          explanation?: string;
          fee_type?: string;
          id?: string;
          locale?: string;
          title?: string;
        };
        Relationships: [];
      };
      fraud_case_events: {
        Row: {
          case_id: string;
          created_at: string;
          event_id: string;
        };
        Insert: {
          case_id?: string;
          created_at?: string;
          event_id?: string;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          event_id?: string;
        };
        Relationships: [];
      };
      fraud_cases: {
        Row: {
          closed_at: string | null;
          closed_by: string | null;
          closure_notes: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          opened_by: string;
          reason: string;
          severity: number;
          status: Database['public']['Enums']['fraud_case_status'];
          subject_key: string;
          subject_kind: Database['public']['Enums']['fraud_subject_kind'];
          updated_at: string;
        };
        Insert: {
          closed_at?: string | null;
          closed_by?: string | null;
          closure_notes?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          opened_by?: string;
          reason?: string;
          severity?: number;
          status?: Database['public']['Enums']['fraud_case_status'];
          subject_key?: string;
          subject_kind?: Database['public']['Enums']['fraud_subject_kind'];
          updated_at?: string;
        };
        Update: {
          closed_at?: string | null;
          closed_by?: string | null;
          closure_notes?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          opened_by?: string;
          reason?: string;
          severity?: number;
          status?: Database['public']['Enums']['fraud_case_status'];
          subject_key?: string;
          subject_kind?: Database['public']['Enums']['fraud_subject_kind'];
          updated_at?: string;
        };
        Relationships: [];
      };
      fraud_enforcement_actions: {
        Row: {
          action_type: string;
          created_at: string;
          expired_at: string | null;
          expires_at: string | null;
          id: string;
          metadata: Json;
          reason: string;
          resolution_notes: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: number;
          subject_key: string;
          subject_kind: Database['public']['Enums']['fraud_subject_kind'];
          updated_at: string;
        };
        Insert: {
          action_type?: string;
          created_at?: string;
          expired_at?: string | null;
          expires_at?: string | null;
          id?: string;
          metadata?: Json;
          reason?: string;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: number;
          subject_key?: string;
          subject_kind?: Database['public']['Enums']['fraud_subject_kind'];
          updated_at?: string;
        };
        Update: {
          action_type?: string;
          created_at?: string;
          expired_at?: string | null;
          expires_at?: string | null;
          id?: string;
          metadata?: Json;
          reason?: string;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: number;
          subject_key?: string;
          subject_kind?: Database['public']['Enums']['fraud_subject_kind'];
          updated_at?: string;
        };
        Relationships: [];
      };
      fraud_events: {
        Row: {
          created_at: string;
          dedupe_key: string | null;
          device_hash: string | null;
          id: string;
          ip_prefix: string | null;
          metadata: Json;
          reason: string;
          score: number;
          severity: number;
          subject_key: string;
          subject_kind: Database['public']['Enums']['fraud_subject_kind'];
        };
        Insert: {
          created_at?: string;
          dedupe_key?: string | null;
          device_hash?: string | null;
          id?: string;
          ip_prefix?: string | null;
          metadata?: Json;
          reason?: string;
          score?: number;
          severity?: number;
          subject_key?: string;
          subject_kind?: Database['public']['Enums']['fraud_subject_kind'];
        };
        Update: {
          created_at?: string;
          dedupe_key?: string | null;
          device_hash?: string | null;
          id?: string;
          ip_prefix?: string | null;
          metadata?: Json;
          reason?: string;
          score?: number;
          severity?: number;
          subject_key?: string;
          subject_kind?: Database['public']['Enums']['fraud_subject_kind'];
        };
        Relationships: [];
      };
      geo_cache: {
        Row: {
          cache_key: string | null;
          capability: string;
          created_at: string;
          expires_at: string;
          provider_code: string;
          response_json: Json;
          updated_at: string;
        };
        Insert: {
          cache_key?: string | null;
          capability?: string;
          created_at?: string;
          expires_at?: string;
          provider_code?: string;
          response_json?: Json;
          updated_at?: string;
        };
        Update: {
          cache_key?: string | null;
          capability?: string;
          created_at?: string;
          expires_at?: string;
          provider_code?: string;
          response_json?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      gift_codes: {
        Row: {
          amount_iqd: number;
          code: string;
          created_at: string;
          created_by: string | null;
          memo: string | null;
          redeemed_at: string | null;
          redeemed_by: string | null;
          redeemed_entry_id: number | null;
          voided_at: string | null;
          voided_by: string | null;
          voided_reason: string | null;
        };
        Insert: {
          amount_iqd?: number;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          memo?: string | null;
          redeemed_at?: string | null;
          redeemed_by?: string | null;
          redeemed_entry_id?: number | null;
          voided_at?: string | null;
          voided_by?: string | null;
          voided_reason?: string | null;
        };
        Update: {
          amount_iqd?: number;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          memo?: string | null;
          redeemed_at?: string | null;
          redeemed_by?: string | null;
          redeemed_entry_id?: number | null;
          voided_at?: string | null;
          voided_by?: string | null;
          voided_reason?: string | null;
        };
        Relationships: [];
      };
      kyc_document_types: {
        Row: {
          allowed_mime: string[];
          country_code: string | null;
          created_at: string;
          description: string | null;
          enabled: boolean;
          id: string;
          is_required: boolean;
          key: string;
          role_required: Database['public']['Enums']['kyc_role_required'];
          sort_order: number;
          title: string;
        };
        Insert: {
          allowed_mime?: string[];
          country_code?: string | null;
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          id?: string;
          is_required?: boolean;
          key?: string;
          role_required?: Database['public']['Enums']['kyc_role_required'];
          sort_order?: number;
          title?: string;
        };
        Update: {
          allowed_mime?: string[];
          country_code?: string | null;
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          id?: string;
          is_required?: boolean;
          key?: string;
          role_required?: Database['public']['Enums']['kyc_role_required'];
          sort_order?: number;
          title?: string;
        };
        Relationships: [];
      };
      kyc_documents: {
        Row: {
          created_at: string;
          doc_type: string;
          document_type_id: string | null;
          id: string;
          metadata: Json;
          mime_type: string | null;
          object_key: string | null;
          profile_id: string | null;
          rejection_reason: string | null;
          status: Database['public']['Enums']['kyc_document_status'] | null;
          storage_bucket: string;
          storage_object_key: string;
          submission_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          doc_type?: string;
          document_type_id?: string | null;
          id?: string;
          metadata?: Json;
          mime_type?: string | null;
          object_key?: string | null;
          profile_id?: string | null;
          rejection_reason?: string | null;
          status?: Database['public']['Enums']['kyc_document_status'] | null;
          storage_bucket?: string;
          storage_object_key?: string;
          submission_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          doc_type?: string;
          document_type_id?: string | null;
          id?: string;
          metadata?: Json;
          mime_type?: string | null;
          object_key?: string | null;
          profile_id?: string | null;
          rejection_reason?: string | null;
          status?: Database['public']['Enums']['kyc_document_status'] | null;
          storage_bucket?: string;
          storage_object_key?: string;
          submission_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      kyc_liveness_sessions: {
        Row: {
          created_at: string;
          id: string;
          profile_id: string;
          provider: string;
          provider_ref: string | null;
          status: Database['public']['Enums']['kyc_liveness_status'];
          submission_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          profile_id?: string;
          provider?: string;
          provider_ref?: string | null;
          status?: Database['public']['Enums']['kyc_liveness_status'];
          submission_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          profile_id?: string;
          provider?: string;
          provider_ref?: string | null;
          status?: Database['public']['Enums']['kyc_liveness_status'];
          submission_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      kyc_submissions: {
        Row: {
          created_at: string;
          decision_note: string | null;
          id: string;
          metadata: Json;
          notes: string | null;
          profile_id: string | null;
          reviewed_at: string | null;
          reviewer_id: string | null;
          reviewer_note: string | null;
          role: string | null;
          role_context: Database['public']['Enums']['party_role'] | null;
          status: Database['public']['Enums']['kyc_submission_status'];
          submitted_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          decision_note?: string | null;
          id?: string;
          metadata?: Json;
          notes?: string | null;
          profile_id?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          reviewer_note?: string | null;
          role?: string | null;
          role_context?: Database['public']['Enums']['party_role'] | null;
          status?: Database['public']['Enums']['kyc_submission_status'];
          submitted_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          decision_note?: string | null;
          id?: string;
          metadata?: Json;
          notes?: string | null;
          profile_id?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          reviewer_note?: string | null;
          role?: string | null;
          role_context?: Database['public']['Enums']['party_role'] | null;
          status?: Database['public']['Enums']['kyc_submission_status'];
          submitted_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      live_activity_throttle_config: {
        Row: {
          created_at: string;
          id: string;
          max_updates_per_trip: number;
          min_interval_seconds: number;
          platform: Database['public']['Enums']['live_activity_platform'];
          significant_eta_change_minutes: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          max_updates_per_trip?: number;
          min_interval_seconds?: number;
          platform?: Database['public']['Enums']['live_activity_platform'];
          significant_eta_change_minutes?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          max_updates_per_trip?: number;
          min_interval_seconds?: number;
          platform?: Database['public']['Enums']['live_activity_platform'];
          significant_eta_change_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      maps_provider_capabilities: {
        Row: {
          capability: string;
          created_at: string;
          enabled: boolean;
          note: string | null;
          provider_code: string;
          unit_label: string;
          updated_at: string;
        };
        Insert: {
          capability?: string;
          created_at?: string;
          enabled?: boolean;
          note?: string | null;
          provider_code?: string;
          unit_label?: string;
          updated_at?: string;
        };
        Update: {
          capability?: string;
          created_at?: string;
          enabled?: boolean;
          note?: string | null;
          provider_code?: string;
          unit_label?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      maps_provider_health: {
        Row: {
          capability: string;
          consecutive_failures: unknown;
          disabled_until: string | null;
          last_error_code: string | null;
          last_failure_at: string | null;
          last_http_status: unknown | null;
          provider_code: string;
          updated_at: string;
        };
        Insert: {
          capability?: string;
          consecutive_failures?: unknown;
          disabled_until?: string | null;
          last_error_code?: string | null;
          last_failure_at?: string | null;
          last_http_status?: unknown | null;
          provider_code?: string;
          updated_at?: string;
        };
        Update: {
          capability?: string;
          consecutive_failures?: unknown;
          disabled_until?: string | null;
          last_error_code?: string | null;
          last_failure_at?: string | null;
          last_http_status?: unknown | null;
          provider_code?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      maps_providers: {
        Row: {
          created_at: string;
          enabled: boolean;
          language: string;
          monthly_hard_cap_units: number | null;
          monthly_soft_cap_units: number | null;
          note: string | null;
          priority: number;
          provider_code: string | null;
          region: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          language?: string;
          monthly_hard_cap_units?: number | null;
          monthly_soft_cap_units?: number | null;
          note?: string | null;
          priority?: number;
          provider_code?: string | null;
          region?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          language?: string;
          monthly_hard_cap_units?: number | null;
          monthly_soft_cap_units?: number | null;
          note?: string | null;
          priority?: number;
          provider_code?: string | null;
          region?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      maps_requests_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          attempt_number: unknown;
          billed_units: unknown;
          cache_hit: boolean;
          capability: string;
          client_renderer: string | null;
          created_at: string;
          error_code: string | null;
          error_detail: string | null;
          fallback_reason: string | null;
          http_status: unknown;
          id: number | null;
          latency_ms: unknown;
          provider_code: string;
          request_id: string;
          request_summary: Json | null;
          response_summary: Json | null;
          tried_providers: string[] | null;
        };
        Insert: {
          action?: string;
          actor_user_id?: string | null;
          attempt_number?: unknown;
          billed_units?: unknown;
          cache_hit?: boolean;
          capability?: string;
          client_renderer?: string | null;
          created_at?: string;
          error_code?: string | null;
          error_detail?: string | null;
          fallback_reason?: string | null;
          http_status?: unknown;
          id?: number | null;
          latency_ms?: unknown;
          provider_code?: string;
          request_id?: string;
          request_summary?: Json | null;
          response_summary?: Json | null;
          tried_providers?: string[] | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          attempt_number?: unknown;
          billed_units?: unknown;
          cache_hit?: boolean;
          capability?: string;
          client_renderer?: string | null;
          created_at?: string;
          error_code?: string | null;
          error_detail?: string | null;
          fallback_reason?: string | null;
          http_status?: unknown;
          id?: number | null;
          latency_ms?: unknown;
          provider_code?: string;
          request_id?: string;
          request_summary?: Json | null;
          response_summary?: Json | null;
          tried_providers?: string[] | null;
        };
        Relationships: [];
      };
      maps_usage_daily: {
        Row: {
          capability: string;
          created_at: string;
          day: string;
          provider_code: string;
          units: number;
          updated_at: string;
        };
        Insert: {
          capability?: string;
          created_at?: string;
          day?: string;
          provider_code?: string;
          units?: number;
          updated_at?: string;
        };
        Update: {
          capability?: string;
          created_at?: string;
          day?: string;
          provider_code?: string;
          units?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      membership_plans: {
        Row: {
          available_regions: string[] | null;
          billing_interval: string;
          code: string;
          created_at: string;
          description: string | null;
          family_sharing_slots: number | null;
          free_delivery_min_order_iqd: number | null;
          id: string;
          is_active: boolean;
          member_exclusive_promos: boolean;
          name: string;
          price_iqd: number;
          service_fee_discount_pct: number | null;
          updated_at: string;
        };
        Insert: {
          available_regions?: string[] | null;
          billing_interval?: string;
          code?: string;
          created_at?: string;
          description?: string | null;
          family_sharing_slots?: number | null;
          free_delivery_min_order_iqd?: number | null;
          id?: string;
          is_active?: boolean;
          member_exclusive_promos?: boolean;
          name?: string;
          price_iqd?: number;
          service_fee_discount_pct?: number | null;
          updated_at?: string;
        };
        Update: {
          available_regions?: string[] | null;
          billing_interval?: string;
          code?: string;
          created_at?: string;
          description?: string | null;
          family_sharing_slots?: number | null;
          free_delivery_min_order_iqd?: number | null;
          id?: string;
          is_active?: boolean;
          member_exclusive_promos?: boolean;
          name?: string;
          price_iqd?: number;
          service_fee_discount_pct?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          cancelled_at: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          is_primary: boolean;
          last_billed_at: string | null;
          next_bill_at: string | null;
          plan_id: string;
          renew_at: string | null;
          shared_from_membership_id: string | null;
          started_at: string;
          status: Database['public']['Enums']['membership_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancelled_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          is_primary?: boolean;
          last_billed_at?: string | null;
          next_bill_at?: string | null;
          plan_id?: string;
          renew_at?: string | null;
          shared_from_membership_id?: string | null;
          started_at?: string;
          status?: Database['public']['Enums']['membership_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          cancelled_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          is_primary?: boolean;
          last_billed_at?: string | null;
          next_bill_at?: string | null;
          plan_id?: string;
          renew_at?: string | null;
          shared_from_membership_id?: string | null;
          started_at?: string;
          status?: Database['public']['Enums']['membership_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      merchant_chat_ai_receipts: {
        Row: {
          created_at: string;
          message_id: string;
          thread_id: string;
        };
        Insert: {
          created_at?: string;
          message_id?: string;
          thread_id?: string;
        };
        Update: {
          created_at?: string;
          message_id?: string;
          thread_id?: string;
        };
        Relationships: [];
      };
      merchant_chat_ai_settings: {
        Row: {
          auto_enabled: boolean;
          auto_reply_mode: Database['public']['Enums']['merchant_chat_auto_reply_mode'];
          created_at: string;
          min_gap_seconds: number;
          thread_id: string;
          updated_at: string;
        };
        Insert: {
          auto_enabled?: boolean;
          auto_reply_mode?: Database['public']['Enums']['merchant_chat_auto_reply_mode'];
          created_at?: string;
          min_gap_seconds?: number;
          thread_id?: string;
          updated_at?: string;
        };
        Update: {
          auto_enabled?: boolean;
          auto_reply_mode?: Database['public']['Enums']['merchant_chat_auto_reply_mode'];
          created_at?: string;
          min_gap_seconds?: number;
          thread_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      merchant_chat_messages: {
        Row: {
          attachments: Json;
          body: string | null;
          created_at: string;
          id: string;
          message_type: Database['public']['Enums']['chat_message_type'];
          sender_id: string;
          thread_id: string;
        };
        Insert: {
          attachments?: Json;
          body?: string | null;
          created_at?: string;
          id?: string;
          message_type?: Database['public']['Enums']['chat_message_type'];
          sender_id?: string;
          thread_id?: string;
        };
        Update: {
          attachments?: Json;
          body?: string | null;
          created_at?: string;
          id?: string;
          message_type?: Database['public']['Enums']['chat_message_type'];
          sender_id?: string;
          thread_id?: string;
        };
        Relationships: [];
      };
      merchant_chat_threads: {
        Row: {
          created_at: string;
          customer_id: string;
          customer_last_read_at: string | null;
          id: string;
          last_message_at: string | null;
          last_message_preview: string | null;
          merchant_id: string;
          merchant_last_read_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          customer_id?: string;
          customer_last_read_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          merchant_id?: string;
          merchant_last_read_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          customer_last_read_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          merchant_id?: string;
          merchant_last_read_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      merchant_commission_configs: {
        Row: {
          cod_handling_flat_fee_iqd: number;
          cod_handling_rate_bps: number;
          created_at: string;
          flat_fee_iqd: number;
          id: string;
          is_active: boolean;
          merchant_id: string | null;
          rate_bps: number;
          updated_at: string;
        };
        Insert: {
          cod_handling_flat_fee_iqd?: number;
          cod_handling_rate_bps?: number;
          created_at?: string;
          flat_fee_iqd?: number;
          id?: string;
          is_active?: boolean;
          merchant_id?: string | null;
          rate_bps?: number;
          updated_at?: string;
        };
        Update: {
          cod_handling_flat_fee_iqd?: number;
          cod_handling_rate_bps?: number;
          created_at?: string;
          flat_fee_iqd?: number;
          id?: string;
          is_active?: boolean;
          merchant_id?: string | null;
          rate_bps?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      merchant_order_deliveries: {
        Row: {
          assigned_at: string | null;
          cancelled_at: string | null;
          cod_change_given_iqd: number;
          cod_collected_amount_iqd: number | null;
          cod_collected_at: string | null;
          cod_expected_amount_iqd: number;
          created_at: string;
          customer_id: string;
          delivered_at: string | null;
          driver_id: string | null;
          dropoff_snapshot: Json;
          fee_iqd: number;
          id: string;
          merchant_id: string;
          order_id: string;
          payment_method_snapshot: Database['public']['Enums']['merchant_order_payment_method'] | null;
          picked_up_at: string | null;
          pickup_snapshot: Json;
          status: Database['public']['Enums']['merchant_order_delivery_status'];
          updated_at: string;
        };
        Insert: {
          assigned_at?: string | null;
          cancelled_at?: string | null;
          cod_change_given_iqd?: number;
          cod_collected_amount_iqd?: number | null;
          cod_collected_at?: string | null;
          cod_expected_amount_iqd?: number;
          created_at?: string;
          customer_id?: string;
          delivered_at?: string | null;
          driver_id?: string | null;
          dropoff_snapshot?: Json;
          fee_iqd?: number;
          id?: string;
          merchant_id?: string;
          order_id?: string;
          payment_method_snapshot?: Database['public']['Enums']['merchant_order_payment_method'] | null;
          picked_up_at?: string | null;
          pickup_snapshot?: Json;
          status?: Database['public']['Enums']['merchant_order_delivery_status'];
          updated_at?: string;
        };
        Update: {
          assigned_at?: string | null;
          cancelled_at?: string | null;
          cod_change_given_iqd?: number;
          cod_collected_amount_iqd?: number | null;
          cod_collected_at?: string | null;
          cod_expected_amount_iqd?: number;
          created_at?: string;
          customer_id?: string;
          delivered_at?: string | null;
          driver_id?: string | null;
          dropoff_snapshot?: Json;
          fee_iqd?: number;
          id?: string;
          merchant_id?: string;
          order_id?: string;
          payment_method_snapshot?: Database['public']['Enums']['merchant_order_payment_method'] | null;
          picked_up_at?: string | null;
          pickup_snapshot?: Json;
          status?: Database['public']['Enums']['merchant_order_delivery_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      merchant_order_delivery_events: {
        Row: {
          actor_id: string | null;
          actor_role: Database['public']['Enums']['delivery_actor_role'] | null;
          created_at: string;
          delivery_id: string;
          from_status: Database['public']['Enums']['merchant_order_delivery_status'] | null;
          id: string;
          note: string | null;
          to_status: Database['public']['Enums']['merchant_order_delivery_status'];
        };
        Insert: {
          actor_id?: string | null;
          actor_role?: Database['public']['Enums']['delivery_actor_role'] | null;
          created_at?: string;
          delivery_id?: string;
          from_status?: Database['public']['Enums']['merchant_order_delivery_status'] | null;
          id?: string;
          note?: string | null;
          to_status?: Database['public']['Enums']['merchant_order_delivery_status'];
        };
        Update: {
          actor_id?: string | null;
          actor_role?: Database['public']['Enums']['delivery_actor_role'] | null;
          created_at?: string;
          delivery_id?: string;
          from_status?: Database['public']['Enums']['merchant_order_delivery_status'] | null;
          id?: string;
          note?: string | null;
          to_status?: Database['public']['Enums']['merchant_order_delivery_status'];
        };
        Relationships: [];
      };
      merchant_order_items: {
        Row: {
          created_at: string;
          id: string;
          line_total_iqd: number;
          meta: Json;
          name_snapshot: string;
          order_id: string;
          product_id: string | null;
          qty: number;
          unit_price_iqd: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_total_iqd?: number;
          meta?: Json;
          name_snapshot?: string;
          order_id?: string;
          product_id?: string | null;
          qty?: number;
          unit_price_iqd?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_total_iqd?: number;
          meta?: Json;
          name_snapshot?: string;
          order_id?: string;
          product_id?: string | null;
          qty?: number;
          unit_price_iqd?: number;
        };
        Relationships: [];
      };
      merchant_order_status_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          from_status: Database['public']['Enums']['merchant_order_status'] | null;
          id: string;
          note: string | null;
          order_id: string;
          to_status: Database['public']['Enums']['merchant_order_status'];
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: Database['public']['Enums']['merchant_order_status'] | null;
          id?: string;
          note?: string | null;
          order_id?: string;
          to_status?: Database['public']['Enums']['merchant_order_status'];
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: Database['public']['Enums']['merchant_order_status'] | null;
          id?: string;
          note?: string | null;
          order_id?: string;
          to_status?: Database['public']['Enums']['merchant_order_status'];
        };
        Relationships: [];
      };
      merchant_orders: {
        Row: {
          address_id: string | null;
          address_snapshot: Json;
          chat_thread_id: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          customer_note: string | null;
          delivery_fee_iqd: number;
          discount_iqd: number;
          id: string;
          merchant_id: string;
          merchant_note: string | null;
          paid_at: string | null;
          payment_method: Database['public']['Enums']['merchant_order_payment_method'];
          payment_status: Database['public']['Enums']['merchant_order_payment_status'];
          status: Database['public']['Enums']['merchant_order_status'];
          status_changed_at: string;
          subtotal_iqd: number;
          total_iqd: number;
          updated_at: string;
        };
        Insert: {
          address_id?: string | null;
          address_snapshot?: Json;
          chat_thread_id?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          customer_note?: string | null;
          delivery_fee_iqd?: number;
          discount_iqd?: number;
          id?: string;
          merchant_id?: string;
          merchant_note?: string | null;
          paid_at?: string | null;
          payment_method?: Database['public']['Enums']['merchant_order_payment_method'];
          payment_status?: Database['public']['Enums']['merchant_order_payment_status'];
          status?: Database['public']['Enums']['merchant_order_status'];
          status_changed_at?: string;
          subtotal_iqd?: number;
          total_iqd?: number;
          updated_at?: string;
        };
        Update: {
          address_id?: string | null;
          address_snapshot?: Json;
          chat_thread_id?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          customer_note?: string | null;
          delivery_fee_iqd?: number;
          discount_iqd?: number;
          id?: string;
          merchant_id?: string;
          merchant_note?: string | null;
          paid_at?: string | null;
          payment_method?: Database['public']['Enums']['merchant_order_payment_method'];
          payment_status?: Database['public']['Enums']['merchant_order_payment_status'];
          status?: Database['public']['Enums']['merchant_order_status'];
          status_changed_at?: string;
          subtotal_iqd?: number;
          total_iqd?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      merchant_products: {
        Row: {
          category: string | null;
          compare_at_price_iqd: number | null;
          created_at: string;
          description: string | null;
          id: string;
          images: Json;
          is_active: boolean;
          is_featured: boolean;
          merchant_id: string;
          metadata: Json;
          name: string;
          price_iqd: number;
          stock_qty: number | null;
          updated_at: string;
        };
        Insert: {
          category?: string | null;
          compare_at_price_iqd?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          images?: Json;
          is_active?: boolean;
          is_featured?: boolean;
          merchant_id?: string;
          metadata?: Json;
          name?: string;
          price_iqd?: number;
          stock_qty?: number | null;
          updated_at?: string;
        };
        Update: {
          category?: string | null;
          compare_at_price_iqd?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          images?: Json;
          is_active?: boolean;
          is_featured?: boolean;
          merchant_id?: string;
          metadata?: Json;
          name?: string;
          price_iqd?: number;
          stock_qty?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      merchant_promotions: {
        Row: {
          category: string | null;
          created_at: string;
          discount_type: Database['public']['Enums']['merchant_promotion_discount_type'];
          ends_at: string | null;
          id: string;
          is_active: boolean;
          merchant_id: string;
          metadata: Json;
          product_id: string | null;
          starts_at: string | null;
          value: number;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          discount_type?: Database['public']['Enums']['merchant_promotion_discount_type'];
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          merchant_id?: string;
          metadata?: Json;
          product_id?: string | null;
          starts_at?: string | null;
          value?: number;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          discount_type?: Database['public']['Enums']['merchant_promotion_discount_type'];
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          merchant_id?: string;
          metadata?: Json;
          product_id?: string | null;
          starts_at?: string | null;
          value?: number;
        };
        Relationships: [];
      };
      merchant_status_audit_log: {
        Row: {
          actor_id: string | null;
          created_at: string;
          from_status: Database['public']['Enums']['merchant_status'] | null;
          id: string;
          merchant_id: string;
          note: string | null;
          to_status: Database['public']['Enums']['merchant_status'];
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: Database['public']['Enums']['merchant_status'] | null;
          id?: string;
          merchant_id?: string;
          note?: string | null;
          to_status?: Database['public']['Enums']['merchant_status'];
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: Database['public']['Enums']['merchant_status'] | null;
          id?: string;
          merchant_id?: string;
          note?: string | null;
          to_status?: Database['public']['Enums']['merchant_status'];
        };
        Relationships: [];
      };
      merchants: {
        Row: {
          address_text: string | null;
          business_name: string;
          business_type: string;
          contact_phone: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          owner_profile_id: string;
          status: Database['public']['Enums']['merchant_status'];
          updated_at: string;
        };
        Insert: {
          address_text?: string | null;
          business_name?: string;
          business_type?: string;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          owner_profile_id?: string;
          status?: Database['public']['Enums']['merchant_status'];
          updated_at?: string;
        };
        Update: {
          address_text?: string | null;
          business_name?: string;
          business_type?: string;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          owner_profile_id?: string;
          status?: Database['public']['Enums']['merchant_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          created_at: string;
          device_token_id: number | null;
          id: number;
          last_attempt_at: string | null;
          last_error: string | null;
          lock_id: string | null;
          locked_at: string | null;
          next_attempt_at: string;
          notification_id: string;
          payload: Json;
          sent_at: string | null;
          status: Database['public']['Enums']['outbox_status'];
          user_id: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          device_token_id?: number | null;
          id?: number;
          last_attempt_at?: string | null;
          last_error?: string | null;
          lock_id?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          notification_id?: string;
          payload?: Json;
          sent_at?: string | null;
          status?: Database['public']['Enums']['outbox_status'];
          user_id?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          device_token_id?: number | null;
          id?: number;
          last_attempt_at?: string | null;
          last_error?: string | null;
          lock_id?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          notification_id?: string;
          payload?: Json;
          sent_at?: string | null;
          status?: Database['public']['Enums']['outbox_status'];
          user_id?: string;
        };
        Relationships: [];
      };
      ops_alert_events: {
        Row: {
          event_type: string;
          id: string;
          message: string | null;
          notified_at: string | null;
          notified_attempts: number;
          notified_channels: Json;
          notified_error: string | null;
          notify_status: string | null;
          occurred_at: string;
          rule_id: string;
          value: Json;
        };
        Insert: {
          event_type?: string;
          id?: string;
          message?: string | null;
          notified_at?: string | null;
          notified_attempts?: number;
          notified_channels?: Json;
          notified_error?: string | null;
          notify_status?: string | null;
          occurred_at?: string;
          rule_id?: string;
          value?: Json;
        };
        Update: {
          event_type?: string;
          id?: string;
          message?: string | null;
          notified_at?: string | null;
          notified_attempts?: number;
          notified_channels?: Json;
          notified_error?: string | null;
          notify_status?: string | null;
          occurred_at?: string;
          rule_id?: string;
          value?: Json;
        };
        Relationships: [];
      };
      ops_alert_rules: {
        Row: {
          config: Json;
          cooldown_minutes: number;
          created_at: string;
          enabled: boolean;
          id: string;
          kind: string;
          name: string;
          severity: string;
          updated_at: string;
          window_minutes: number;
        };
        Insert: {
          config?: Json;
          cooldown_minutes?: number;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          kind?: string;
          name?: string;
          severity?: string;
          updated_at?: string;
          window_minutes?: number;
        };
        Update: {
          config?: Json;
          cooldown_minutes?: number;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          kind?: string;
          name?: string;
          severity?: string;
          updated_at?: string;
          window_minutes?: number;
        };
        Relationships: [];
      };
      ops_alert_state: {
        Row: {
          active_since: string | null;
          escalated_at: string | null;
          is_active: boolean;
          last_escalation_notified_at: string | null;
          last_evaluated_at: string | null;
          last_message: string | null;
          last_resolved_at: string | null;
          last_triggered_at: string | null;
          last_value: Json;
          rule_id: string;
          updated_at: string;
        };
        Insert: {
          active_since?: string | null;
          escalated_at?: string | null;
          is_active?: boolean;
          last_escalation_notified_at?: string | null;
          last_evaluated_at?: string | null;
          last_message?: string | null;
          last_resolved_at?: string | null;
          last_triggered_at?: string | null;
          last_value?: Json;
          rule_id?: string;
          updated_at?: string;
        };
        Update: {
          active_since?: string | null;
          escalated_at?: string | null;
          is_active?: boolean;
          last_escalation_notified_at?: string | null;
          last_evaluated_at?: string | null;
          last_message?: string | null;
          last_resolved_at?: string | null;
          last_triggered_at?: string | null;
          last_value?: Json;
          rule_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      order_bundles: {
        Row: {
          additional_fee_iqd: number;
          addon_window_expires_at: string;
          created_at: string;
          fee_waived: boolean;
          id: string;
          primary_order_id: string;
          same_courier: boolean;
          status: Database['public']['Enums']['order_bundle_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          additional_fee_iqd?: number;
          addon_window_expires_at?: string;
          created_at?: string;
          fee_waived?: boolean;
          id?: string;
          primary_order_id?: string;
          same_courier?: boolean;
          status?: Database['public']['Enums']['order_bundle_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          additional_fee_iqd?: number;
          addon_window_expires_at?: string;
          created_at?: string;
          fee_waived?: boolean;
          id?: string;
          primary_order_id?: string;
          same_courier?: boolean;
          status?: Database['public']['Enums']['order_bundle_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          bundle_id: string | null;
        };
        Insert: {
          bundle_id?: string | null;
        };
        Update: {
          bundle_id?: string | null;
        };
        Relationships: [];
      };
      passkey_auth_log: {
        Row: {
          created_at: string;
          device_info: Json | null;
          event_type: string;
          failure_reason: string | null;
          id: string;
          ip_address: unknown | null;
          passkey_id: string | null;
          success: boolean;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_info?: Json | null;
          event_type?: string;
          failure_reason?: string | null;
          id?: string;
          ip_address?: unknown | null;
          passkey_id?: string | null;
          success?: boolean;
          user_agent?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          device_info?: Json | null;
          event_type?: string;
          failure_reason?: string | null;
          id?: string;
          ip_address?: unknown | null;
          passkey_id?: string | null;
          success?: boolean;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      payment_intents: {
        Row: {
          amount_iqd: number;
          created_at: string;
          currency: string;
          id: string;
          idempotency_key: string | null;
          last_error: string | null;
          metadata: Json;
          provider: string;
          provider_charge_id: string | null;
          provider_payment_intent_id: string | null;
          provider_ref: string | null;
          provider_session_id: string | null;
          ride_id: string;
          status: Database['public']['Enums']['payment_intent_status'];
          updated_at: string;
        };
        Insert: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          idempotency_key?: string | null;
          last_error?: string | null;
          metadata?: Json;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_session_id?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['payment_intent_status'];
          updated_at?: string;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          idempotency_key?: string | null;
          last_error?: string | null;
          metadata?: Json;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_session_id?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['payment_intent_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_providers: {
        Row: {
          code: string;
          config: Json;
          created_at: string;
          enabled: boolean;
          kind: Database['public']['Enums']['payment_provider_kind'];
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code?: string;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          kind?: Database['public']['Enums']['payment_provider_kind'];
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          code?: string;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          kind?: Database['public']['Enums']['payment_provider_kind'];
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_refund_idempotency: {
        Row: {
          actor_id: string | null;
          created_at: string;
          key: string | null;
          params_hash: string;
          payment_id: string | null;
          response: Json | null;
          ride_id: string;
          updated_at: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          key?: string | null;
          params_hash?: string;
          payment_id?: string | null;
          response?: Json | null;
          ride_id?: string;
          updated_at?: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          key?: string | null;
          params_hash?: string;
          payment_id?: string | null;
          response?: Json | null;
          ride_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount_iqd: number;
          created_at: string;
          currency: string;
          failure_code: string | null;
          failure_message: string | null;
          id: string;
          metadata: Json;
          method: string | null;
          payment_intent_id: string | null;
          provider: string;
          provider_charge_id: string | null;
          provider_payment_intent_id: string | null;
          provider_ref: string | null;
          provider_refund_id: string | null;
          refund_amount_iqd: number | null;
          refunded_at: string | null;
          ride_id: string;
          status: Database['public']['Enums']['payment_status'];
          updated_at: string;
        };
        Insert: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          id?: string;
          metadata?: Json;
          method?: string | null;
          payment_intent_id?: string | null;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_refund_id?: string | null;
          refund_amount_iqd?: number | null;
          refunded_at?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['payment_status'];
          updated_at?: string;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          id?: string;
          metadata?: Json;
          method?: string | null;
          payment_intent_id?: string | null;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_refund_id?: string | null;
          refund_amount_iqd?: number | null;
          refunded_at?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['payment_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      payout_idempotency: {
        Row: {
          created_at: string;
          id: number;
          key: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          key?: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          key?: string;
        };
        Relationships: [];
      };
      payout_provider_job_attempts: {
        Row: {
          attempt_no: number;
          created_at: string;
          error_message: string | null;
          id: string;
          job_id: string;
          request_payload: Json | null;
          response_payload: Json | null;
          status: Database['public']['Enums']['payout_provider_job_attempt_status'];
        };
        Insert: {
          attempt_no?: number;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          job_id?: string;
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: Database['public']['Enums']['payout_provider_job_attempt_status'];
        };
        Update: {
          attempt_no?: number;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          job_id?: string;
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: Database['public']['Enums']['payout_provider_job_attempt_status'];
        };
        Relationships: [];
      };
      payout_provider_jobs: {
        Row: {
          amount_iqd: number;
          attempt_count: number;
          canceled_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          created_by: string | null;
          failed_at: string | null;
          id: string;
          last_attempt_at: string | null;
          last_error: string | null;
          lock_token: string | null;
          locked_at: string | null;
          max_attempts: number;
          next_attempt_at: string;
          payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
          provider_idempotency_key: string | null;
          provider_ref: string | null;
          request_payload: Json | null;
          response_payload: Json | null;
          sent_at: string | null;
          status: Database['public']['Enums']['payout_provider_job_status'];
          updated_at: string;
          withdraw_request_id: string;
        };
        Insert: {
          amount_iqd?: number;
          attempt_count?: number;
          canceled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          failed_at?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          lock_token?: string | null;
          locked_at?: string | null;
          max_attempts?: number;
          next_attempt_at?: string;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          provider_idempotency_key?: string | null;
          provider_ref?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['payout_provider_job_status'];
          updated_at?: string;
          withdraw_request_id?: string;
        };
        Update: {
          amount_iqd?: number;
          attempt_count?: number;
          canceled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          failed_at?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          lock_token?: string | null;
          locked_at?: string | null;
          max_attempts?: number;
          next_attempt_at?: string;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          provider_idempotency_key?: string | null;
          provider_ref?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['payout_provider_job_status'];
          updated_at?: string;
          withdraw_request_id?: string;
        };
        Relationships: [];
      };
      platform_fee_configs: {
        Row: {
          active: boolean;
          created_at: string;
          flat_fee_iqd: number;
          id: string;
          product_code: string;
          rate_bps: number;
          service_area_id: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          flat_fee_iqd?: number;
          id?: string;
          product_code?: string;
          rate_bps?: number;
          service_area_id?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          flat_fee_iqd?: number;
          id?: string;
          product_code?: string;
          rate_bps?: number;
          service_area_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pricing_configs: {
        Row: {
          active: boolean;
          base_fare_iqd: number;
          created_at: string;
          currency: string;
          effective_from: string;
          effective_to: string | null;
          id: string;
          is_default: boolean;
          max_surge_multiplier: number;
          minimum_fare_iqd: number;
          name: string | null;
          per_km_iqd: number;
          per_min_iqd: number;
          updated_at: string;
          version: number;
        };
        Insert: {
          active?: boolean;
          base_fare_iqd?: number;
          created_at?: string;
          currency?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          is_default?: boolean;
          max_surge_multiplier?: number;
          minimum_fare_iqd?: number;
          name?: string | null;
          per_km_iqd?: number;
          per_min_iqd?: number;
          updated_at?: string;
          version?: number;
        };
        Update: {
          active?: boolean;
          base_fare_iqd?: number;
          created_at?: string;
          currency?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          is_default?: boolean;
          max_surge_multiplier?: number;
          minimum_fare_iqd?: number;
          name?: string | null;
          per_km_iqd?: number;
          per_min_iqd?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      pricing_rules: {
        Row: {
          code: string;
          created_at: string;
          delivery_fee_iqd: number | null;
          delivery_fee_waived: boolean;
          description: string | null;
          environment: string | null;
          id: string;
          is_active: boolean;
          max_subtotal_iqd: number | null;
          membership_plan_codes: string[] | null;
          min_subtotal_iqd: number | null;
          name: string;
          priority: number;
          regions: string[] | null;
          requires_membership: boolean;
          service_fee_pct: number | null;
          small_order_fee_iqd: number | null;
          updated_at: string;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          code?: string;
          created_at?: string;
          delivery_fee_iqd?: number | null;
          delivery_fee_waived?: boolean;
          description?: string | null;
          environment?: string | null;
          id?: string;
          is_active?: boolean;
          max_subtotal_iqd?: number | null;
          membership_plan_codes?: string[] | null;
          min_subtotal_iqd?: number | null;
          name?: string;
          priority?: number;
          regions?: string[] | null;
          requires_membership?: boolean;
          service_fee_pct?: number | null;
          small_order_fee_iqd?: number | null;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          delivery_fee_iqd?: number | null;
          delivery_fee_waived?: boolean;
          description?: string | null;
          environment?: string | null;
          id?: string;
          is_active?: boolean;
          max_subtotal_iqd?: number | null;
          membership_plan_codes?: string[] | null;
          min_subtotal_iqd?: number | null;
          name?: string;
          priority?: number;
          regions?: string[] | null;
          requires_membership?: boolean;
          service_fee_pct?: number | null;
          small_order_fee_iqd?: number | null;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [];
      };
      profile_kyc: {
        Row: {
          note: string | null;
          status: Database['public']['Enums']['kyc_status'];
          updated_at: string;
          updated_by: string | null;
          user_id: string;
        };
        Insert: {
          note?: string | null;
          status?: Database['public']['Enums']['kyc_status'];
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Update: {
          note?: string | null;
          status?: Database['public']['Enums']['kyc_status'];
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active_role: Database['public']['Enums']['user_role'];
          avatar_object_key: string | null;
          created_at: string;
          display_name: string | null;
          gender: Database['public']['Enums']['user_gender'] | null;
          id: string;
          is_admin: boolean;
          locale: string;
          phone: string | null;
          phone_e164: string | null;
          rating_avg: number;
          rating_count: number;
          role_onboarding_completed: boolean;
          updated_at: string;
        };
        Insert: {
          active_role?: Database['public']['Enums']['user_role'];
          avatar_object_key?: string | null;
          created_at?: string;
          display_name?: string | null;
          gender?: Database['public']['Enums']['user_gender'] | null;
          id?: string;
          is_admin?: boolean;
          locale?: string;
          phone?: string | null;
          phone_e164?: string | null;
          rating_avg?: number;
          rating_count?: number;
          role_onboarding_completed?: boolean;
          updated_at?: string;
        };
        Update: {
          active_role?: Database['public']['Enums']['user_role'];
          avatar_object_key?: string | null;
          created_at?: string;
          display_name?: string | null;
          gender?: Database['public']['Enums']['user_gender'] | null;
          id?: string;
          is_admin?: boolean;
          locale?: string;
          phone?: string | null;
          phone_e164?: string | null;
          rating_avg?: number;
          rating_count?: number;
          role_onboarding_completed?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      promotion_notification_receipts: {
        Row: {
          created_at: string;
          notification_id: string | null;
          promotion_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          notification_id?: string | null;
          promotion_id?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          notification_id?: string | null;
          promotion_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      provider_events: {
        Row: {
          id: number;
          payload: Json;
          provider_code: string;
          provider_event_id: string;
          received_at: string;
        };
        Insert: {
          id?: number;
          payload?: Json;
          provider_code?: string;
          provider_event_id?: string;
          received_at?: string;
        };
        Update: {
          id?: number;
          payload?: Json;
          provider_code?: string;
          provider_event_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      public_profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          rating_avg: number;
          rating_count: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          rating_avg?: number;
          rating_count?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          rating_avg?: number;
          rating_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      recovery_codes: {
        Row: {
          batch_id: string;
          code_hash: string;
          created_at: string;
          id: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          batch_id?: string;
          code_hash?: string;
          created_at?: string;
          id?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Update: {
          batch_id?: string;
          code_hash?: string;
          created_at?: string;
          id?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      referral_campaigns: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          key: string;
          referred_reward_iqd: number;
          referrer_reward_iqd: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          key?: string;
          referred_reward_iqd?: number;
          referrer_reward_iqd?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          key?: string;
          referred_reward_iqd?: number;
          referrer_reward_iqd?: number;
        };
        Relationships: [];
      };
      referral_codes: {
        Row: {
          code: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          code?: string;
          created_at?: string;
          user_id?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      referral_invites: {
        Row: {
          code_used: string;
          created_at: string;
          id: string;
          qualified_at: string | null;
          referred_user_id: string;
          referrer_id: string;
          rewarded_at: string | null;
          status: Database['public']['Enums']['referral_invite_status'];
        };
        Insert: {
          code_used?: string;
          created_at?: string;
          id?: string;
          qualified_at?: string | null;
          referred_user_id?: string;
          referrer_id?: string;
          rewarded_at?: string | null;
          status?: Database['public']['Enums']['referral_invite_status'];
        };
        Update: {
          code_used?: string;
          created_at?: string;
          id?: string;
          qualified_at?: string | null;
          referred_user_id?: string;
          referrer_id?: string;
          rewarded_at?: string | null;
          status?: Database['public']['Enums']['referral_invite_status'];
        };
        Relationships: [];
      };
      referral_redemptions: {
        Row: {
          campaign_id: string;
          code: string;
          created_at: string;
          earned_at: string | null;
          id: string;
          referred_id: string;
          referrer_id: string;
          rewarded_at: string | null;
          ride_id: string | null;
          status: Database['public']['Enums']['referral_redemption_status'];
        };
        Insert: {
          campaign_id?: string;
          code?: string;
          created_at?: string;
          earned_at?: string | null;
          id?: string;
          referred_id?: string;
          referrer_id?: string;
          rewarded_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['referral_redemption_status'];
        };
        Update: {
          campaign_id?: string;
          code?: string;
          created_at?: string;
          earned_at?: string | null;
          id?: string;
          referred_id?: string;
          referrer_id?: string;
          rewarded_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['referral_redemption_status'];
        };
        Relationships: [];
      };
      referral_settings: {
        Row: {
          created_at: string;
          id: number;
          min_completed_rides: number;
          reward_referee_iqd: number;
          reward_referrer_iqd: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          min_completed_rides?: number;
          reward_referee_iqd?: number;
          reward_referrer_iqd?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          min_completed_rides?: number;
          reward_referee_iqd?: number;
          reward_referrer_iqd?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_chat_messages: {
        Row: {
          attachment_bucket: string | null;
          attachment_key: string | null;
          attachments: Json;
          body: string | null;
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['chat_message_type'] | null;
          media_object_key: string | null;
          message: string | null;
          message_type: Database['public']['Enums']['chat_message_type'];
          metadata: Json | null;
          ride_id: string;
          sender_id: string;
          thread_id: string | null;
          updated_at: string;
        };
        Insert: {
          attachment_bucket?: string | null;
          attachment_key?: string | null;
          attachments?: Json;
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['chat_message_type'] | null;
          media_object_key?: string | null;
          message?: string | null;
          message_type?: Database['public']['Enums']['chat_message_type'];
          metadata?: Json | null;
          ride_id?: string;
          sender_id?: string;
          thread_id?: string | null;
          updated_at?: string;
        };
        Update: {
          attachment_bucket?: string | null;
          attachment_key?: string | null;
          attachments?: Json;
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['chat_message_type'] | null;
          media_object_key?: string | null;
          message?: string | null;
          message_type?: Database['public']['Enums']['chat_message_type'];
          metadata?: Json | null;
          ride_id?: string;
          sender_id?: string;
          thread_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_chat_read_receipts: {
        Row: {
          id: string;
          last_read_at: string | null;
          last_read_message_id: string | null;
          message_id: string | null;
          read_at: string;
          reader_id: string | null;
          ride_id: string;
          thread_id: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          id?: string;
          last_read_at?: string | null;
          last_read_message_id?: string | null;
          message_id?: string | null;
          read_at?: string;
          reader_id?: string | null;
          ride_id?: string;
          thread_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          id?: string;
          last_read_at?: string | null;
          last_read_message_id?: string | null;
          message_id?: string | null;
          read_at?: string;
          reader_id?: string | null;
          ride_id?: string;
          thread_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      ride_chat_threads: {
        Row: {
          created_at: string;
          driver_id: string;
          id: string;
          ride_id: string;
          rider_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          driver_id?: string;
          id?: string;
          ride_id?: string;
          rider_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          driver_id?: string;
          id?: string;
          ride_id?: string;
          rider_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_chat_typing: {
        Row: {
          is_typing: boolean;
          profile_id: string;
          ride_id: string;
          updated_at: string;
        };
        Insert: {
          is_typing?: boolean;
          profile_id?: string;
          ride_id?: string;
          updated_at?: string;
        };
        Update: {
          is_typing?: boolean;
          profile_id?: string;
          ride_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_completion_log: {
        Row: {
          processed_at: string;
          ride_id: string;
        };
        Insert: {
          processed_at?: string;
          ride_id?: string;
        };
        Update: {
          processed_at?: string;
          ride_id?: string;
        };
        Relationships: [];
      };
      ride_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database['public']['Enums']['ride_actor_type'];
          created_at: string;
          event_type: string;
          id: number;
          payload: Json;
          ride_id: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_type?: Database['public']['Enums']['ride_actor_type'];
          created_at?: string;
          event_type?: string;
          id?: number;
          payload?: Json;
          ride_id?: string;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database['public']['Enums']['ride_actor_type'];
          created_at?: string;
          event_type?: string;
          id?: number;
          payload?: Json;
          ride_id?: string;
        };
        Relationships: [];
      };
      ride_incidents: {
        Row: {
          assigned_to: string | null;
          category: string;
          created_at: string;
          description: string | null;
          id: string;
          lat: number | null;
          lng: number | null;
          loc: unknown | null;
          metadata: Json;
          reporter_id: string;
          reporter_type: string | null;
          resolution_note: string | null;
          reviewed_at: string | null;
          ride_id: string | null;
          severity: Database['public']['Enums']['incident_severity'];
          status: Database['public']['Enums']['incident_status'];
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          loc?: unknown | null;
          metadata?: Json;
          reporter_id?: string;
          reporter_type?: string | null;
          resolution_note?: string | null;
          reviewed_at?: string | null;
          ride_id?: string | null;
          severity?: Database['public']['Enums']['incident_severity'];
          status?: Database['public']['Enums']['incident_status'];
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          loc?: unknown | null;
          metadata?: Json;
          reporter_id?: string;
          reporter_type?: string | null;
          resolution_note?: string | null;
          reviewed_at?: string | null;
          ride_id?: string | null;
          severity?: Database['public']['Enums']['incident_severity'];
          status?: Database['public']['Enums']['incident_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_intents: {
        Row: {
          converted_request_id: string | null;
          created_at: string;
          dropoff_address: string | null;
          dropoff_lat: number;
          dropoff_lng: number;
          dropoff_loc: unknown | null;
          id: string;
          notes: string | null;
          pickup_address: string | null;
          pickup_lat: number;
          pickup_lng: number;
          pickup_loc: unknown | null;
          preferences: Json;
          product_code: string;
          rider_id: string;
          scheduled_at: string | null;
          service_area_id: string | null;
          source: Database['public']['Enums']['ride_intent_source'];
          status: Database['public']['Enums']['ride_intent_status'];
          updated_at: string;
        };
        Insert: {
          converted_request_id?: string | null;
          created_at?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          dropoff_loc?: unknown | null;
          id?: string;
          notes?: string | null;
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          pickup_loc?: unknown | null;
          preferences?: Json;
          product_code?: string;
          rider_id?: string;
          scheduled_at?: string | null;
          service_area_id?: string | null;
          source?: Database['public']['Enums']['ride_intent_source'];
          status?: Database['public']['Enums']['ride_intent_status'];
          updated_at?: string;
        };
        Update: {
          converted_request_id?: string | null;
          created_at?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          dropoff_loc?: unknown | null;
          id?: string;
          notes?: string | null;
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          pickup_loc?: unknown | null;
          preferences?: Json;
          product_code?: string;
          rider_id?: string;
          scheduled_at?: string | null;
          service_area_id?: string | null;
          source?: Database['public']['Enums']['ride_intent_source'];
          status?: Database['public']['Enums']['ride_intent_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_products: {
        Row: {
          capacity_min: number;
          code: string;
          created_at: string;
          description: string | null;
          is_active: boolean;
          name: string;
          price_multiplier: number;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          capacity_min?: number;
          code?: string;
          created_at?: string;
          description?: string | null;
          is_active?: boolean;
          name?: string;
          price_multiplier?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          capacity_min?: number;
          code?: string;
          created_at?: string;
          description?: string | null;
          is_active?: boolean;
          name?: string;
          price_multiplier?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_ratings: {
        Row: {
          comment: string | null;
          created_at: string;
          id: string;
          ratee_id: string;
          ratee_role: Database['public']['Enums']['party_role'];
          rater_id: string;
          rater_role: Database['public']['Enums']['party_role'];
          rating: number;
          ride_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          ratee_id?: string;
          ratee_role?: Database['public']['Enums']['party_role'];
          rater_id?: string;
          rater_role?: Database['public']['Enums']['party_role'];
          rating?: number;
          ride_id?: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          ratee_id?: string;
          ratee_role?: Database['public']['Enums']['party_role'];
          rater_id?: string;
          rater_role?: Database['public']['Enums']['party_role'];
          rating?: number;
          ride_id?: string;
        };
        Relationships: [];
      };
      ride_receipts: {
        Row: {
          base_fare_iqd: number | null;
          currency: string;
          generated_at: string;
          receipt_status: Database['public']['Enums']['ride_receipt_status'];
          refunded_at: string | null;
          refunded_iqd: number;
          ride_id: string;
          tax_iqd: number;
          tip_iqd: number;
          total_iqd: number;
        };
        Insert: {
          base_fare_iqd?: number | null;
          currency?: string;
          generated_at?: string;
          receipt_status?: Database['public']['Enums']['ride_receipt_status'];
          refunded_at?: string | null;
          refunded_iqd?: number;
          ride_id?: string;
          tax_iqd?: number;
          tip_iqd?: number;
          total_iqd?: number;
        };
        Update: {
          base_fare_iqd?: number | null;
          currency?: string;
          generated_at?: string;
          receipt_status?: Database['public']['Enums']['ride_receipt_status'];
          refunded_at?: string | null;
          refunded_iqd?: number;
          ride_id?: string;
          tax_iqd?: number;
          tip_iqd?: number;
          total_iqd?: number;
        };
        Relationships: [];
      };
      ride_requests: {
        Row: {
          accepted_at: string | null;
          assigned_driver_id: string | null;
          cancelled_at: string | null;
          created_at: string;
          currency: string;
          dropoff_address: string | null;
          dropoff_lat: number;
          dropoff_lng: number;
          dropoff_loc: unknown | null;
          fare_quote_id: string | null;
          id: string;
          match_attempts: number;
          match_deadline: string | null;
          matched_at: string | null;
          payment_method: Database['public']['Enums']['ride_payment_method'];
          payment_status: Database['public']['Enums']['ride_payment_status'];
          pickup_address: string | null;
          pickup_lat: number;
          pickup_lng: number;
          pickup_loc: unknown | null;
          preferences: Json;
          product_code: string;
          quote_amount_iqd: number | null;
          rider_id: string;
          service_area_id: string | null;
          status: Database['public']['Enums']['ride_request_status'];
          updated_at: string;
          women_preferences_fallback_used: boolean;
          women_preferences_fulfilled: boolean;
          women_preferences_match_attempt_ms: number | null;
          women_preferences_requested: boolean;
        };
        Insert: {
          accepted_at?: string | null;
          assigned_driver_id?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          currency?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          dropoff_loc?: unknown | null;
          fare_quote_id?: string | null;
          id?: string;
          match_attempts?: number;
          match_deadline?: string | null;
          matched_at?: string | null;
          payment_method?: Database['public']['Enums']['ride_payment_method'];
          payment_status?: Database['public']['Enums']['ride_payment_status'];
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          pickup_loc?: unknown | null;
          preferences?: Json;
          product_code?: string;
          quote_amount_iqd?: number | null;
          rider_id?: string;
          service_area_id?: string | null;
          status?: Database['public']['Enums']['ride_request_status'];
          updated_at?: string;
          women_preferences_fallback_used?: boolean;
          women_preferences_fulfilled?: boolean;
          women_preferences_match_attempt_ms?: number | null;
          women_preferences_requested?: boolean;
        };
        Update: {
          accepted_at?: string | null;
          assigned_driver_id?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          currency?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          dropoff_loc?: unknown | null;
          fare_quote_id?: string | null;
          id?: string;
          match_attempts?: number;
          match_deadline?: string | null;
          matched_at?: string | null;
          payment_method?: Database['public']['Enums']['ride_payment_method'];
          payment_status?: Database['public']['Enums']['ride_payment_status'];
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          pickup_loc?: unknown | null;
          preferences?: Json;
          product_code?: string;
          quote_amount_iqd?: number | null;
          rider_id?: string;
          service_area_id?: string | null;
          status?: Database['public']['Enums']['ride_request_status'];
          updated_at?: string;
          women_preferences_fallback_used?: boolean;
          women_preferences_fulfilled?: boolean;
          women_preferences_match_attempt_ms?: number | null;
          women_preferences_requested?: boolean;
        };
        Relationships: [];
      };
      ridecheck_events: {
        Row: {
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['ridecheck_kind'];
          metadata: Json;
          resolved_at: string | null;
          ride_id: string;
          status: Database['public']['Enums']['ridecheck_event_status'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['ridecheck_kind'];
          metadata?: Json;
          resolved_at?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['ridecheck_event_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['ridecheck_kind'];
          metadata?: Json;
          resolved_at?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['ridecheck_event_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      ridecheck_responses: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          note: string | null;
          response: Database['public']['Enums']['ridecheck_response'];
          ride_id: string;
          role: Database['public']['Enums']['party_role'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_id?: string;
          id?: string;
          note?: string | null;
          response?: Database['public']['Enums']['ridecheck_response'];
          ride_id?: string;
          role?: Database['public']['Enums']['party_role'];
          user_id?: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          note?: string | null;
          response?: Database['public']['Enums']['ridecheck_response'];
          ride_id?: string;
          role?: Database['public']['Enums']['party_role'];
          user_id?: string;
        };
        Relationships: [];
      };
      ridecheck_state: {
        Row: {
          distance_increase_streak: number;
          last_distance_to_dropoff_m: number | null;
          last_loc: unknown | null;
          last_move_at: string;
          last_seen_at: string;
          ride_id: string;
          updated_at: string;
        };
        Insert: {
          distance_increase_streak?: number;
          last_distance_to_dropoff_m?: number | null;
          last_loc?: unknown | null;
          last_move_at?: string;
          last_seen_at?: string;
          ride_id?: string;
          updated_at?: string;
        };
        Update: {
          distance_increase_streak?: number;
          last_distance_to_dropoff_m?: number | null;
          last_loc?: unknown | null;
          last_move_at?: string;
          last_seen_at?: string;
          ride_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rides: {
        Row: {
          cash_change_given_iqd: number | null;
          cash_collected_amount_iqd: number | null;
          cash_collected_at: string | null;
          cash_expected_amount_iqd: number | null;
          completed_at: string | null;
          created_at: string;
          currency: string;
          driver_id: string;
          fare_amount_iqd: number | null;
          id: string;
          paid_at: string | null;
          payment_intent_id: string | null;
          payment_method: Database['public']['Enums']['ride_payment_method'];
          payment_status: Database['public']['Enums']['ride_payment_status'];
          pickup_pin_fail_count: number;
          pickup_pin_last_attempt_at: string | null;
          pickup_pin_locked_until: string | null;
          pickup_pin_required: boolean;
          pickup_pin_verified_at: string | null;
          platform_fee_iqd: number | null;
          product_code: string;
          request_id: string;
          rider_id: string;
          started_at: string | null;
          status: Database['public']['Enums']['ride_status'];
          updated_at: string;
          version: number;
          wallet_hold_id: string | null;
        };
        Insert: {
          cash_change_given_iqd?: number | null;
          cash_collected_amount_iqd?: number | null;
          cash_collected_at?: string | null;
          cash_expected_amount_iqd?: number | null;
          completed_at?: string | null;
          created_at?: string;
          currency?: string;
          driver_id?: string;
          fare_amount_iqd?: number | null;
          id?: string;
          paid_at?: string | null;
          payment_intent_id?: string | null;
          payment_method?: Database['public']['Enums']['ride_payment_method'];
          payment_status?: Database['public']['Enums']['ride_payment_status'];
          pickup_pin_fail_count?: number;
          pickup_pin_last_attempt_at?: string | null;
          pickup_pin_locked_until?: string | null;
          pickup_pin_required?: boolean;
          pickup_pin_verified_at?: string | null;
          platform_fee_iqd?: number | null;
          product_code?: string;
          request_id?: string;
          rider_id?: string;
          started_at?: string | null;
          status?: Database['public']['Enums']['ride_status'];
          updated_at?: string;
          version?: number;
          wallet_hold_id?: string | null;
        };
        Update: {
          cash_change_given_iqd?: number | null;
          cash_collected_amount_iqd?: number | null;
          cash_collected_at?: string | null;
          cash_expected_amount_iqd?: number | null;
          completed_at?: string | null;
          created_at?: string;
          currency?: string;
          driver_id?: string;
          fare_amount_iqd?: number | null;
          id?: string;
          paid_at?: string | null;
          payment_intent_id?: string | null;
          payment_method?: Database['public']['Enums']['ride_payment_method'];
          payment_status?: Database['public']['Enums']['ride_payment_status'];
          pickup_pin_fail_count?: number;
          pickup_pin_last_attempt_at?: string | null;
          pickup_pin_locked_until?: string | null;
          pickup_pin_required?: boolean;
          pickup_pin_verified_at?: string | null;
          platform_fee_iqd?: number | null;
          product_code?: string;
          request_id?: string;
          rider_id?: string;
          started_at?: string | null;
          status?: Database['public']['Enums']['ride_status'];
          updated_at?: string;
          version?: number;
          wallet_hold_id?: string | null;
        };
        Relationships: [];
      };
      safety_mismatch_reports: {
        Row: {
          created_at: string;
          description: string | null;
          evidence_urls: string[] | null;
          id: string;
          report_type: string;
          reported_user_id: string;
          reporter_id: string;
          review_notes: string | null;
          review_outcome: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          ride_id: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          evidence_urls?: string[] | null;
          id?: string;
          report_type?: string;
          reported_user_id?: string;
          reporter_id?: string;
          review_notes?: string | null;
          review_outcome?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          ride_id?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          evidence_urls?: string[] | null;
          id?: string;
          report_type?: string;
          reported_user_id?: string;
          reporter_id?: string;
          review_notes?: string | null;
          review_outcome?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          ride_id?: string | null;
        };
        Relationships: [];
      };
      safety_preferences: {
        Row: {
          created_at: string;
          gender_identity: Database['public']['Enums']['gender_identity'];
          gender_visibility: Database['public']['Enums']['gender_visibility'];
          is_teen: boolean;
          updated_at: string;
          user_id: string;
          women_preferences_driver_opt_in: boolean;
          women_preferences_eligible: boolean;
          women_preferences_enabled: boolean;
        };
        Insert: {
          created_at?: string;
          gender_identity?: Database['public']['Enums']['gender_identity'];
          gender_visibility?: Database['public']['Enums']['gender_visibility'];
          is_teen?: boolean;
          updated_at?: string;
          user_id?: string;
          women_preferences_driver_opt_in?: boolean;
          women_preferences_eligible?: boolean;
          women_preferences_enabled?: boolean;
        };
        Update: {
          created_at?: string;
          gender_identity?: Database['public']['Enums']['gender_identity'];
          gender_visibility?: Database['public']['Enums']['gender_visibility'];
          is_teen?: boolean;
          updated_at?: string;
          user_id?: string;
          women_preferences_driver_opt_in?: boolean;
          women_preferences_eligible?: boolean;
          women_preferences_enabled?: boolean;
        };
        Relationships: [];
      };
      scheduled_rides: {
        Row: {
          cancelled_at: string | null;
          created_at: string;
          currency: string;
          dropoff_address: string | null;
          dropoff_lat: number;
          dropoff_lng: number;
          executed_at: string | null;
          failure_reason: string | null;
          fare_quote_id: string | null;
          id: string;
          payment_method: Database['public']['Enums']['ride_payment_method'];
          payment_status: Database['public']['Enums']['ride_payment_status'];
          pickup_address: string | null;
          pickup_lat: number;
          pickup_lng: number;
          preferences: Json;
          product_code: string;
          quote_amount_iqd: number | null;
          ride_request_id: string | null;
          rider_id: string;
          scheduled_at: string;
          service_area_id: string | null;
          status: Database['public']['Enums']['scheduled_ride_status'];
          updated_at: string;
        };
        Insert: {
          cancelled_at?: string | null;
          created_at?: string;
          currency?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          executed_at?: string | null;
          failure_reason?: string | null;
          fare_quote_id?: string | null;
          id?: string;
          payment_method?: Database['public']['Enums']['ride_payment_method'];
          payment_status?: Database['public']['Enums']['ride_payment_status'];
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          preferences?: Json;
          product_code?: string;
          quote_amount_iqd?: number | null;
          ride_request_id?: string | null;
          rider_id?: string;
          scheduled_at?: string;
          service_area_id?: string | null;
          status?: Database['public']['Enums']['scheduled_ride_status'];
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          created_at?: string;
          currency?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          executed_at?: string | null;
          failure_reason?: string | null;
          fare_quote_id?: string | null;
          id?: string;
          payment_method?: Database['public']['Enums']['ride_payment_method'];
          payment_status?: Database['public']['Enums']['ride_payment_status'];
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          preferences?: Json;
          product_code?: string;
          quote_amount_iqd?: number | null;
          ride_request_id?: string | null;
          rider_id?: string;
          scheduled_at?: string;
          service_area_id?: string | null;
          status?: Database['public']['Enums']['scheduled_ride_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      service_areas: {
        Row: {
          cash_rounding_step_iqd: number;
          created_at: string;
          driver_loc_stale_after_seconds: number;
          geom: unknown;
          governorate: string | null;
          id: string;
          is_active: boolean;
          match_radius_m: number;
          min_base_fare_iqd: number | null;
          name: string;
          notes: string | null;
          pricing_config_id: string | null;
          priority: number;
          surge_multiplier: number;
          surge_reason: string | null;
          updated_at: string;
        };
        Insert: {
          cash_rounding_step_iqd?: number;
          created_at?: string;
          driver_loc_stale_after_seconds?: number;
          geom?: unknown;
          governorate?: string | null;
          id?: string;
          is_active?: boolean;
          match_radius_m?: number;
          min_base_fare_iqd?: number | null;
          name?: string;
          notes?: string | null;
          pricing_config_id?: string | null;
          priority?: number;
          surge_multiplier?: number;
          surge_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          cash_rounding_step_iqd?: number;
          created_at?: string;
          driver_loc_stale_after_seconds?: number;
          geom?: unknown;
          governorate?: string | null;
          id?: string;
          is_active?: boolean;
          match_radius_m?: number;
          min_base_fare_iqd?: number | null;
          name?: string;
          notes?: string | null;
          pricing_config_id?: string | null;
          priority?: number;
          surge_multiplier?: number;
          surge_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      settlement_accounts: {
        Row: {
          balance_iqd: number;
          created_at: string;
          currency: string;
          id: string;
          party_id: string;
          party_type: Database['public']['Enums']['settlement_party_type'];
          updated_at: string;
        };
        Insert: {
          balance_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          updated_at?: string;
        };
        Update: {
          balance_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          updated_at?: string;
        };
        Relationships: [];
      };
      settlement_entries: {
        Row: {
          account_id: string;
          created_at: string;
          delta_iqd: number;
          id: string;
          idempotency_key: string | null;
          reason: string;
          ref_id: string | null;
          ref_type: string | null;
        };
        Insert: {
          account_id?: string;
          created_at?: string;
          delta_iqd?: number;
          id?: string;
          idempotency_key?: string | null;
          reason?: string;
          ref_id?: string | null;
          ref_type?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          delta_iqd?: number;
          id?: string;
          idempotency_key?: string | null;
          reason?: string;
          ref_id?: string | null;
          ref_type?: string | null;
        };
        Relationships: [];
      };
      settlement_payment_requests: {
        Row: {
          admin_note: string | null;
          amount_iqd: number;
          created_at: string;
          id: string;
          idempotency_key: string | null;
          method: string;
          party_id: string;
          party_type: Database['public']['Enums']['settlement_party_type'];
          processed_at: string | null;
          processed_by: string | null;
          reference: string | null;
          requested_at: string;
          requested_by: string;
          status: Database['public']['Enums']['settlement_request_status'];
        };
        Insert: {
          admin_note?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          processed_at?: string | null;
          processed_by?: string | null;
          reference?: string | null;
          requested_at?: string;
          requested_by?: string;
          status?: Database['public']['Enums']['settlement_request_status'];
        };
        Update: {
          admin_note?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          processed_at?: string | null;
          processed_by?: string | null;
          reference?: string | null;
          requested_at?: string;
          requested_by?: string;
          status?: Database['public']['Enums']['settlement_request_status'];
        };
        Relationships: [];
      };
      settlement_payout_requests: {
        Row: {
          admin_note: string | null;
          amount_iqd: number;
          created_at: string;
          id: string;
          idempotency_key: string | null;
          method: string;
          party_id: string;
          party_type: Database['public']['Enums']['settlement_party_type'];
          processed_at: string | null;
          processed_by: string | null;
          reference: string | null;
          requested_at: string;
          requested_by: string;
          status: Database['public']['Enums']['settlement_request_status'];
        };
        Insert: {
          admin_note?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          processed_at?: string | null;
          processed_by?: string | null;
          reference?: string | null;
          requested_at?: string;
          requested_by?: string;
          status?: Database['public']['Enums']['settlement_request_status'];
        };
        Update: {
          admin_note?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          processed_at?: string | null;
          processed_by?: string | null;
          reference?: string | null;
          requested_at?: string;
          requested_by?: string;
          status?: Database['public']['Enums']['settlement_request_status'];
        };
        Relationships: [];
      };
      settlement_payouts: {
        Row: {
          agent_id: string | null;
          amount_iqd: number;
          created_at: string;
          id: string;
          idempotency_key: string | null;
          method: string;
          paid_at: string;
          paid_by: string;
          party_id: string;
          party_type: Database['public']['Enums']['settlement_party_type'];
          payout_no: string | null;
          reference: string | null;
        };
        Insert: {
          agent_id?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          paid_at?: string;
          paid_by?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          payout_no?: string | null;
          reference?: string | null;
        };
        Update: {
          agent_id?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          paid_at?: string;
          paid_by?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          payout_no?: string | null;
          reference?: string | null;
        };
        Relationships: [];
      };
      settlement_receipts: {
        Row: {
          agent_id: string | null;
          amount_iqd: number;
          created_at: string;
          id: string;
          idempotency_key: string | null;
          method: string;
          party_id: string;
          party_type: Database['public']['Enums']['settlement_party_type'];
          receipt_no: string | null;
          received_at: string;
          received_by: string;
          reference: string | null;
        };
        Insert: {
          agent_id?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          receipt_no?: string | null;
          received_at?: string;
          received_by?: string;
          reference?: string | null;
        };
        Update: {
          agent_id?: string | null;
          amount_iqd?: number;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          method?: string;
          party_id?: string;
          party_type?: Database['public']['Enums']['settlement_party_type'];
          receipt_no?: string | null;
          received_at?: string;
          received_by?: string;
          reference?: string | null;
        };
        Relationships: [];
      };
      shift_progress: {
        Row: {
          avg_rating: number | null;
          created_at: string;
          earnings_iqd: number;
          id: string;
          online_minutes: number;
          shift_id: string;
          trips_completed: number;
        };
        Insert: {
          avg_rating?: number | null;
          created_at?: string;
          earnings_iqd?: number;
          id?: string;
          online_minutes?: number;
          shift_id?: string;
          trips_completed?: number;
        };
        Update: {
          avg_rating?: number | null;
          created_at?: string;
          earnings_iqd?: number;
          id?: string;
          online_minutes?: number;
          shift_id?: string;
          trips_completed?: number;
        };
        Relationships: [];
      };
      sos_events: {
        Row: {
          created_at: string;
          id: string;
          lat: number | null;
          lng: number | null;
          metadata: Json;
          resolved_at: string | null;
          ride_id: string | null;
          status: Database['public']['Enums']['sos_event_status'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          metadata?: Json;
          resolved_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['sos_event_status'];
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          metadata?: Json;
          resolved_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['sos_event_status'];
          user_id?: string;
        };
        Relationships: [];
      };
      support_articles: {
        Row: {
          body_md: string;
          created_at: string;
          enabled: boolean;
          id: string;
          section_id: string | null;
          slug: string;
          summary: string | null;
          tags: string[];
          title: string;
          updated_at: string;
        };
        Insert: {
          body_md?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          section_id?: string | null;
          slug?: string;
          summary?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
        };
        Update: {
          body_md?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          section_id?: string | null;
          slug?: string;
          summary?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      support_categories: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          enabled: boolean;
          id: string | null;
          is_active: boolean;
          key: string | null;
          sort_order: number;
          title: string;
        };
        Insert: {
          code?: string;
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          id?: string | null;
          is_active?: boolean;
          key?: string | null;
          sort_order?: number;
          title?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          id?: string | null;
          is_active?: boolean;
          key?: string | null;
          sort_order?: number;
          title?: string;
        };
        Relationships: [];
      };
      support_internal_notes: {
        Row: {
          author_id: string;
          created_at: string;
          id: string | null;
          note: string;
          ticket_id: string;
        };
        Insert: {
          author_id?: string;
          created_at?: string;
          id?: string | null;
          note?: string;
          ticket_id?: string;
        };
        Update: {
          author_id?: string;
          created_at?: string;
          id?: string | null;
          note?: string;
          ticket_id?: string;
        };
        Relationships: [];
      };
      support_messages: {
        Row: {
          attachments: Json;
          body: string | null;
          created_at: string;
          id: string;
          message: string;
          sender_id: string;
          sender_profile_id: string | null;
          ticket_id: string;
        };
        Insert: {
          attachments?: Json;
          body?: string | null;
          created_at?: string;
          id?: string;
          message?: string;
          sender_id?: string;
          sender_profile_id?: string | null;
          ticket_id?: string;
        };
        Update: {
          attachments?: Json;
          body?: string | null;
          created_at?: string;
          id?: string;
          message?: string;
          sender_id?: string;
          sender_profile_id?: string | null;
          ticket_id?: string;
        };
        Relationships: [];
      };
      support_sections: {
        Row: {
          created_at: string;
          enabled: boolean;
          id: string;
          key: string;
          sort_order: number;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          key?: string;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          key?: string;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      support_tickets: {
        Row: {
          assigned_to: string | null;
          category_code: string | null;
          category_id: string | null;
          created_at: string;
          created_by: string;
          id: string;
          notes: string | null;
          priority: Database['public']['Enums']['support_ticket_priority'];
          resolved_at: string | null;
          ride_id: string | null;
          role_context: Database['public']['Enums']['user_role'] | null;
          status: Database['public']['Enums']['support_ticket_status'];
          subject: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          category_code?: string | null;
          category_id?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          notes?: string | null;
          priority?: Database['public']['Enums']['support_ticket_priority'];
          resolved_at?: string | null;
          ride_id?: string | null;
          role_context?: Database['public']['Enums']['user_role'] | null;
          status?: Database['public']['Enums']['support_ticket_status'];
          subject?: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          category_code?: string | null;
          category_id?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          notes?: string | null;
          priority?: Database['public']['Enums']['support_ticket_priority'];
          resolved_at?: string | null;
          ride_id?: string | null;
          role_context?: Database['public']['Enums']['user_role'] | null;
          status?: Database['public']['Enums']['support_ticket_status'];
          subject?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      teen_policies: {
        Row: {
          allowed_hours: Json | null;
          created_at: string;
          destination_lock_enabled: boolean;
          family_id: string;
          geofence_allowlist: Json | null;
          id: string;
          pickup_pin_enabled: boolean;
          spend_cap_daily: number | null;
          teen_user_id: string;
          updated_at: string;
        };
        Insert: {
          allowed_hours?: Json | null;
          created_at?: string;
          destination_lock_enabled?: boolean;
          family_id?: string;
          geofence_allowlist?: Json | null;
          id?: string;
          pickup_pin_enabled?: boolean;
          spend_cap_daily?: number | null;
          teen_user_id?: string;
          updated_at?: string;
        };
        Update: {
          allowed_hours?: Json | null;
          created_at?: string;
          destination_lock_enabled?: boolean;
          family_id?: string;
          geofence_allowlist?: Json | null;
          id?: string;
          pickup_pin_enabled?: boolean;
          spend_cap_daily?: number | null;
          teen_user_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      topup_intents: {
        Row: {
          amount_iqd: number;
          bonus_iqd: number;
          completed_at: string | null;
          created_at: string;
          failure_reason: string | null;
          id: string;
          idempotency_key: string | null;
          package_id: string | null;
          provider_code: string;
          provider_payload: Json;
          provider_tx_id: string | null;
          status: Database['public']['Enums']['topup_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_iqd?: number;
          bonus_iqd?: number;
          completed_at?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          idempotency_key?: string | null;
          package_id?: string | null;
          provider_code?: string;
          provider_payload?: Json;
          provider_tx_id?: string | null;
          status?: Database['public']['Enums']['topup_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount_iqd?: number;
          bonus_iqd?: number;
          completed_at?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          idempotency_key?: string | null;
          package_id?: string | null;
          provider_code?: string;
          provider_payload?: Json;
          provider_tx_id?: string | null;
          status?: Database['public']['Enums']['topup_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      topup_packages: {
        Row: {
          active: boolean;
          amount_iqd: number;
          bonus_iqd: number;
          created_at: string;
          id: string;
          label: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amount_iqd?: number;
          bonus_iqd?: number;
          created_at?: string;
          id?: string;
          label?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount_iqd?: number;
          bonus_iqd?: number;
          created_at?: string;
          id?: string;
          label?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      trip_guardian_links: {
        Row: {
          created_at: string;
          guardian_live_tracking_enabled: boolean;
          guardian_user_id: string;
          id: string;
          teen_user_id: string;
          trip_id: string;
        };
        Insert: {
          created_at?: string;
          guardian_live_tracking_enabled?: boolean;
          guardian_user_id?: string;
          id?: string;
          teen_user_id?: string;
          trip_id?: string;
        };
        Update: {
          created_at?: string;
          guardian_live_tracking_enabled?: boolean;
          guardian_user_id?: string;
          id?: string;
          teen_user_id?: string;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_live_activities: {
        Row: {
          created_at: string;
          id: string;
          last_pushed_at: string | null;
          platform: Database['public']['Enums']['live_activity_platform'];
          push_count: number;
          revoked_at: string | null;
          show_full_addresses: boolean;
          token: string;
          trip_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_pushed_at?: string | null;
          platform?: Database['public']['Enums']['live_activity_platform'];
          push_count?: number;
          revoked_at?: string | null;
          show_full_addresses?: boolean;
          token?: string;
          trip_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_pushed_at?: string | null;
          platform?: Database['public']['Enums']['live_activity_platform'];
          push_count?: number;
          revoked_at?: string | null;
          show_full_addresses?: boolean;
          token?: string;
          trip_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      trip_share_tokens: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          ride_id: string;
          token: string | null;
          token_hash: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          ride_id?: string;
          token?: string | null;
          token_hash?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          ride_id?: string;
          token?: string | null;
          token_hash?: string | null;
        };
        Relationships: [];
      };
      trip_status_transitions: {
        Row: {
          broadcast_at: string | null;
          broadcast_sent: boolean;
          created_at: string;
          distance_remaining_m: number | null;
          eta_minutes: number | null;
          id: string;
          new_status: string;
          old_status: string | null;
          trip_id: string;
        };
        Insert: {
          broadcast_at?: string | null;
          broadcast_sent?: boolean;
          created_at?: string;
          distance_remaining_m?: number | null;
          eta_minutes?: number | null;
          id?: string;
          new_status?: string;
          old_status?: string | null;
          trip_id?: string;
        };
        Update: {
          broadcast_at?: string | null;
          broadcast_sent?: boolean;
          created_at?: string;
          distance_remaining_m?: number | null;
          eta_minutes?: number | null;
          id?: string;
          new_status?: string;
          old_status?: string | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trusted_contact_events: {
        Row: {
          contact_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          payload: Json;
          ride_id: string | null;
          status: Database['public']['Enums']['trusted_contact_event_status'];
          user_id: string;
        };
        Insert: {
          contact_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          payload?: Json;
          ride_id?: string | null;
          status?: Database['public']['Enums']['trusted_contact_event_status'];
          user_id?: string;
        };
        Update: {
          contact_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          payload?: Json;
          ride_id?: string | null;
          status?: Database['public']['Enums']['trusted_contact_event_status'];
          user_id?: string;
        };
        Relationships: [];
      };
      trusted_contact_outbox: {
        Row: {
          attempts: number;
          channel: Database['public']['Enums']['contact_channel'];
          contact_id: string;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          last_error: string | null;
          last_http_status: number | null;
          last_response: string | null;
          next_attempt_at: string;
          payload: Json;
          provider_message_id: string | null;
          ride_id: string | null;
          sos_event_id: string;
          status: Database['public']['Enums']['outbox_status'];
          to_phone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          channel?: Database['public']['Enums']['contact_channel'];
          contact_id?: string;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          last_http_status?: number | null;
          last_response?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          provider_message_id?: string | null;
          ride_id?: string | null;
          sos_event_id?: string;
          status?: Database['public']['Enums']['outbox_status'];
          to_phone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          attempts?: number;
          channel?: Database['public']['Enums']['contact_channel'];
          contact_id?: string;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          last_http_status?: number | null;
          last_response?: string | null;
          next_attempt_at?: string;
          payload?: Json;
          provider_message_id?: string | null;
          ride_id?: string | null;
          sos_event_id?: string;
          status?: Database['public']['Enums']['outbox_status'];
          to_phone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      trusted_contacts: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          phone: string;
          phone_e164: string | null;
          relationship: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          phone?: string;
          phone_e164?: string | null;
          relationship?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          phone?: string;
          phone_e164?: string | null;
          relationship?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_device_tokens: {
        Row: {
          created_at: string;
          device_id: string;
          id: string;
          last_seen_at: string;
          platform: Database['public']['Enums']['device_platform'];
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_id?: string;
          id?: string;
          last_seen_at?: string;
          platform?: Database['public']['Enums']['device_platform'];
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          device_id?: string;
          id?: string;
          last_seen_at?: string;
          platform?: Database['public']['Enums']['device_platform'];
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_interest_targets: {
        Row: {
          category: string | null;
          created_at: string;
          enabled: boolean;
          id: string;
          keyword: string | null;
          kind: Database['public']['Enums']['user_interest_target_kind'];
          max_per_week: number;
          merchant_id: string | null;
          notify_inapp: boolean;
          notify_push: boolean;
          product_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          keyword?: string | null;
          kind?: Database['public']['Enums']['user_interest_target_kind'];
          max_per_week?: number;
          merchant_id?: string | null;
          notify_inapp?: boolean;
          notify_push?: boolean;
          product_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          keyword?: string | null;
          kind?: Database['public']['Enums']['user_interest_target_kind'];
          max_per_week?: number;
          merchant_id?: string | null;
          notify_inapp?: boolean;
          notify_push?: boolean;
          product_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: Json;
          id: string;
          kind: string;
          read_at: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          kind?: string;
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          kind?: string;
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_passkeys: {
        Row: {
          aaguid: unknown | null;
          backup_eligible: boolean;
          backup_state: boolean;
          created_at: string;
          credential_id: unknown;
          device_type: string | null;
          friendly_name: string | null;
          id: string;
          last_used_at: string | null;
          passkey_type: Database['public']['Enums']['passkey_type'];
          public_key: unknown;
          revoked_at: string | null;
          revoked_reason: string | null;
          sign_count: number;
          status: Database['public']['Enums']['passkey_status'];
          transports: string[] | null;
          updated_at: string;
          use_count: number;
          user_agent: string | null;
          user_id: string;
          webauthn_device_type: string | null;
        };
        Insert: {
          aaguid?: unknown | null;
          backup_eligible?: boolean;
          backup_state?: boolean;
          created_at?: string;
          credential_id?: unknown;
          device_type?: string | null;
          friendly_name?: string | null;
          id?: string;
          last_used_at?: string | null;
          passkey_type?: Database['public']['Enums']['passkey_type'];
          public_key?: unknown;
          revoked_at?: string | null;
          revoked_reason?: string | null;
          sign_count?: number;
          status?: Database['public']['Enums']['passkey_status'];
          transports?: string[] | null;
          updated_at?: string;
          use_count?: number;
          user_agent?: string | null;
          user_id?: string;
          webauthn_device_type?: string | null;
        };
        Update: {
          aaguid?: unknown | null;
          backup_eligible?: boolean;
          backup_state?: boolean;
          created_at?: string;
          credential_id?: unknown;
          device_type?: string | null;
          friendly_name?: string | null;
          id?: string;
          last_used_at?: string | null;
          passkey_type?: Database['public']['Enums']['passkey_type'];
          public_key?: unknown;
          revoked_at?: string | null;
          revoked_reason?: string | null;
          sign_count?: number;
          status?: Database['public']['Enums']['passkey_status'];
          transports?: string[] | null;
          updated_at?: string;
          use_count?: number;
          user_agent?: string | null;
          user_id?: string;
          webauthn_device_type?: string | null;
        };
        Relationships: [];
      };
      user_safety_settings: {
        Row: {
          auto_notify_on_sos: boolean;
          auto_share_on_trip_start: boolean;
          created_at: string;
          default_share_ttl_minutes: number;
          pin_verification_mode: Database['public']['Enums']['pin_verification_mode'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          auto_notify_on_sos?: boolean;
          auto_share_on_trip_start?: boolean;
          created_at?: string;
          default_share_ttl_minutes?: number;
          pin_verification_mode?: Database['public']['Enums']['pin_verification_mode'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          auto_notify_on_sos?: boolean;
          auto_share_on_trip_start?: boolean;
          created_at?: string;
          default_share_ttl_minutes?: number;
          pin_verification_mode?: Database['public']['Enums']['pin_verification_mode'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      voice_call_participants: {
        Row: {
          call_id: string;
          is_initiator: boolean;
          joined_at: string | null;
          left_at: string | null;
          profile_id: string;
          role: Database['public']['Enums']['voice_call_participant_role'];
        };
        Insert: {
          call_id?: string;
          is_initiator?: boolean;
          joined_at?: string | null;
          left_at?: string | null;
          profile_id?: string;
          role?: Database['public']['Enums']['voice_call_participant_role'];
        };
        Update: {
          call_id?: string;
          is_initiator?: boolean;
          joined_at?: string | null;
          left_at?: string | null;
          profile_id?: string;
          role?: Database['public']['Enums']['voice_call_participant_role'];
        };
        Relationships: [];
      };
      voice_calls: {
        Row: {
          agora_channel: string | null;
          created_at: string;
          created_by: string;
          daily_room_name: string | null;
          daily_room_url: string | null;
          ended_at: string | null;
          id: string;
          metadata: Json;
          pipecat_agent_name: string | null;
          pipecat_session_id: string | null;
          provider: Database['public']['Enums']['voice_call_provider'];
          ride_id: string | null;
          started_at: string | null;
          status: Database['public']['Enums']['voice_call_status'];
          updated_at: string;
        };
        Insert: {
          agora_channel?: string | null;
          created_at?: string;
          created_by?: string;
          daily_room_name?: string | null;
          daily_room_url?: string | null;
          ended_at?: string | null;
          id?: string;
          metadata?: Json;
          pipecat_agent_name?: string | null;
          pipecat_session_id?: string | null;
          provider?: Database['public']['Enums']['voice_call_provider'];
          ride_id?: string | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['voice_call_status'];
          updated_at?: string;
        };
        Update: {
          agora_channel?: string | null;
          created_at?: string;
          created_by?: string;
          daily_room_name?: string | null;
          daily_room_url?: string | null;
          ended_at?: string | null;
          id?: string;
          metadata?: Json;
          pipecat_agent_name?: string | null;
          pipecat_session_id?: string | null;
          provider?: Database['public']['Enums']['voice_call_provider'];
          ride_id?: string | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['voice_call_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      wallet_accounts: {
        Row: {
          balance_iqd: number;
          created_at: string;
          held_iqd: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance_iqd?: number;
          created_at?: string;
          held_iqd?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          balance_iqd?: number;
          created_at?: string;
          held_iqd?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_entries: {
        Row: {
          created_at: string;
          delta_iqd: number;
          id: number;
          idempotency_key: string | null;
          kind: Database['public']['Enums']['wallet_entry_kind'];
          memo: string | null;
          metadata: Json;
          source_id: string | null;
          source_type: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          delta_iqd?: number;
          id?: number;
          idempotency_key?: string | null;
          kind?: Database['public']['Enums']['wallet_entry_kind'];
          memo?: string | null;
          metadata?: Json;
          source_id?: string | null;
          source_type?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          delta_iqd?: number;
          id?: number;
          idempotency_key?: string | null;
          kind?: Database['public']['Enums']['wallet_entry_kind'];
          memo?: string | null;
          metadata?: Json;
          source_id?: string | null;
          source_type?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_holds: {
        Row: {
          amount_iqd: number;
          captured_at: string | null;
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['wallet_hold_kind'];
          reason: string | null;
          released_at: string | null;
          ride_id: string | null;
          status: Database['public']['Enums']['wallet_hold_status'];
          updated_at: string;
          user_id: string;
          withdraw_request_id: string | null;
        };
        Insert: {
          amount_iqd?: number;
          captured_at?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['wallet_hold_kind'];
          reason?: string | null;
          released_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['wallet_hold_status'];
          updated_at?: string;
          user_id?: string;
          withdraw_request_id?: string | null;
        };
        Update: {
          amount_iqd?: number;
          captured_at?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['wallet_hold_kind'];
          reason?: string | null;
          released_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['wallet_hold_status'];
          updated_at?: string;
          user_id?: string;
          withdraw_request_id?: string | null;
        };
        Relationships: [];
      };
      wallet_payout_attempts: {
        Row: {
          amount_iqd: number;
          created_at: string;
          created_by: string | null;
          destination: Json;
          error_code: string | null;
          error_message: string | null;
          id: string;
          payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
          provider_reference: string | null;
          request_payload: Json | null;
          response_payload: Json | null;
          status: Database['public']['Enums']['payout_attempt_status'];
          updated_at: string;
          withdraw_request_id: string;
        };
        Insert: {
          amount_iqd?: number;
          created_at?: string;
          created_by?: string | null;
          destination?: Json;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          provider_reference?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: Database['public']['Enums']['payout_attempt_status'];
          updated_at?: string;
          withdraw_request_id?: string;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          created_by?: string | null;
          destination?: Json;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          provider_reference?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: Database['public']['Enums']['payout_attempt_status'];
          updated_at?: string;
          withdraw_request_id?: string;
        };
        Relationships: [];
      };
      wallet_withdraw_audit_log: {
        Row: {
          action: string;
          actor_is_admin: boolean;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          new_status: Database['public']['Enums']['withdraw_request_status'] | null;
          note: string | null;
          old_status: Database['public']['Enums']['withdraw_request_status'] | null;
          request_id: string;
        };
        Insert: {
          action?: string;
          actor_is_admin?: boolean;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          new_status?: Database['public']['Enums']['withdraw_request_status'] | null;
          note?: string | null;
          old_status?: Database['public']['Enums']['withdraw_request_status'] | null;
          request_id?: string;
        };
        Update: {
          action?: string;
          actor_is_admin?: boolean;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          new_status?: Database['public']['Enums']['withdraw_request_status'] | null;
          note?: string | null;
          old_status?: Database['public']['Enums']['withdraw_request_status'] | null;
          request_id?: string;
        };
        Relationships: [];
      };
      wallet_withdraw_payout_methods: {
        Row: {
          created_at: string;
          enabled: boolean;
          payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      wallet_withdraw_requests: {
        Row: {
          amount_iqd: number;
          approved_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          destination: Json;
          id: string;
          idempotency_key: string | null;
          note: string | null;
          paid_at: string | null;
          payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
          payout_reference: string | null;
          rejected_at: string | null;
          status: Database['public']['Enums']['withdraw_request_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_iqd?: number;
          approved_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          destination?: Json;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          paid_at?: string | null;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          payout_reference?: string | null;
          rejected_at?: string | null;
          status?: Database['public']['Enums']['withdraw_request_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount_iqd?: number;
          approved_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          destination?: Json;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          paid_at?: string | null;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          payout_reference?: string | null;
          rejected_at?: string | null;
          status?: Database['public']['Enums']['withdraw_request_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_withdrawal_policy: {
        Row: {
          created_at: string;
          daily_cap_amount_iqd: number;
          daily_cap_count: number;
          id: number;
          max_amount_iqd: number;
          min_amount_iqd: number;
          min_trips_count: number;
          require_driver_not_suspended: boolean;
          require_kyc: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          daily_cap_amount_iqd?: number;
          daily_cap_count?: number;
          id?: number;
          max_amount_iqd?: number;
          min_amount_iqd?: number;
          min_trips_count?: number;
          require_driver_not_suspended?: boolean;
          require_kyc?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          daily_cap_amount_iqd?: number;
          daily_cap_count?: number;
          id?: number;
          max_amount_iqd?: number;
          min_amount_iqd?: number;
          min_trips_count?: number;
          require_driver_not_suspended?: boolean;
          require_kyc?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      webauthn_challenges: {
        Row: {
          challenge: unknown;
          challenge_type: string;
          created_at: string;
          expires_at: string;
          id: string;
          session_id: string | null;
          used_at: string | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          challenge?: unknown;
          challenge_type?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          session_id?: string | null;
          used_at?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          challenge?: unknown;
          challenge_type?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          session_id?: string | null;
          used_at?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      webhook_job_attempts: {
        Row: {
          attempt_no: number;
          created_at: string;
          error_message: string | null;
          id: string;
          job_id: string;
          status: string;
        };
        Insert: {
          attempt_no?: number;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          job_id?: string;
          status?: string;
        };
        Update: {
          attempt_no?: number;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          job_id?: string;
          status?: string;
        };
        Relationships: [];
      };
      webhook_jobs: {
        Row: {
          attempt_count: number;
          correlation_id: string | null;
          created_at: string;
          dedupe_key: string;
          id: string;
          job_kind: string;
          last_attempt_at: string | null;
          last_error: string | null;
          lock_token: string | null;
          locked_at: string | null;
          max_attempts: number;
          next_attempt_at: string;
          provider_code: string;
          provider_event_id: string;
          provider_event_pk: number | null;
          status: Database['public']['Enums']['webhook_job_status'];
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          correlation_id?: string | null;
          created_at?: string;
          dedupe_key?: string;
          id?: string;
          job_kind?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          lock_token?: string | null;
          locked_at?: string | null;
          max_attempts?: number;
          next_attempt_at?: string;
          provider_code?: string;
          provider_event_id?: string;
          provider_event_pk?: number | null;
          status?: Database['public']['Enums']['webhook_job_status'];
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          correlation_id?: string | null;
          created_at?: string;
          dedupe_key?: string;
          id?: string;
          job_kind?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          lock_token?: string | null;
          locked_at?: string | null;
          max_attempts?: number;
          next_attempt_at?: string;
          provider_code?: string;
          provider_event_id?: string;
          provider_event_pk?: number | null;
          status?: Database['public']['Enums']['webhook_job_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      _admin_require_role_v1: {
        Args: {
        };
        Returns: undefined;
      };
      _edge_webhook_post: {
        Args: {
          p_function_name: string;
          p_payload: Json;
          p_secret_name: string;
        };
        Returns: number;
      };
      _fraud_require_service_role: {
        Args: {
        };
        Returns: undefined;
      };
      _rbac_sync_on_admin_users_delete: {
        Args: {
        };
        Returns: unknown;
      };
      _rbac_sync_on_admin_users_insert: {
        Args: {
        };
        Returns: unknown;
      };
      _vault_secret: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
      achievement_claim: {
        Args: {
          p_key: string;
        };
        Returns: unknown;
      };
      admin_approve_role_change_request_v1: {
        Args: {
          p_note: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      admin_cash_agent_create_v1: {
        Args: {
          p_code: string;
          p_location: string;
          p_name: string;
        };
        Returns: string;
      };
      admin_cash_agent_list_v1: {
        Args: {
          p_active_only: boolean;
        };
        Returns: unknown;
      };
      admin_cash_agent_next_doc_no_v1: {
        Args: {
          p_agent_id: string;
          p_day: string;
          p_kind: string;
        };
        Returns: string;
      };
      admin_cash_agent_set_active_v1: {
        Args: {
          p_agent_id: string;
          p_is_active: boolean;
        };
        Returns: undefined;
      };
      admin_cashbox_close_day_v1: {
        Args: {
          p_agent_id: string;
          p_counted_cash_iqd: number;
          p_day: string;
          p_idempotency_key: string;
          p_note: string;
        };
        Returns: string;
      };
      admin_cashbox_reconciliation_v1: {
        Args: {
          p_agent_id: string;
          p_date_from: string;
          p_date_to: string;
        };
        Returns: unknown;
      };
      admin_clone_pricing_config_v1: {
        Args: {
          p_active: boolean;
          p_effective_from: string;
          p_name: string;
          p_set_default: boolean;
          p_source_id: string;
        };
        Returns: string;
      };
      admin_create_gift_code: {
        Args: {
          p_amount_iqd: number;
          p_code: string;
          p_memo: string;
        };
        Returns: unknown;
      };
      admin_create_role_change_request_v1: {
        Args: {
          p_note: string;
          p_role_keys: string[];
          p_user: string;
        };
        Returns: Json;
      };
      admin_create_service_area_bbox: {
        Args: {
          p_governorate: string;
          p_is_active: boolean;
          p_max_lat: number;
          p_max_lng: number;
          p_min_lat: number;
          p_min_lng: number;
          p_name: string;
          p_pricing_config_id: string;
          p_priority: number;
        };
        Returns: string;
      };
      admin_create_service_area_bbox_v2: {
        Args: {
          p_governorate: string;
          p_is_active: boolean;
          p_max_lat: number;
          p_max_lng: number;
          p_min_base_fare_iqd: number;
          p_min_lat: number;
          p_min_lng: number;
          p_name: string;
          p_notes: string;
          p_pricing_config_id: string;
          p_priority: number;
          p_surge_multiplier: number;
          p_surge_reason: string;
        };
        Returns: string;
      };
      admin_create_service_area_bbox_v3: {
        Args: {
          p_cash_rounding_step_iqd: number;
          p_governorate: string;
          p_is_active: boolean;
          p_max_lat: number;
          p_max_lng: number;
          p_min_base_fare_iqd: number;
          p_min_lat: number;
          p_min_lng: number;
          p_name: string;
          p_pricing_config_id: string;
          p_priority: number;
          p_surge_multiplier: number;
          p_surge_reason: string;
        };
        Returns: string;
      };
      admin_generate_gift_codes_v1: {
        Args: {
          p_amount_iqd: number;
          p_count: number;
          p_length: number;
          p_memo: string;
          p_prefix: string;
        };
        Returns: unknown;
      };
      admin_gift_codes_list_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_q: string;
          p_status: string;
        };
        Returns: unknown;
      };
      admin_grant_user: {
        Args: {
          p_note: string;
          p_user: string;
        };
        Returns: undefined;
      };
      admin_grant_user_v1: {
        Args: {
          p_note: string;
          p_user: string;
        };
        Returns: Json;
      };
      admin_has_permission: {
        Args: {
          p_permission: string;
        };
        Returns: boolean;
      };
      admin_list_admin_access_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_q: string;
        };
        Returns: unknown;
      };
      admin_list_role_change_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_status: string;
        };
        Returns: unknown;
      };
      admin_list_role_change_requests_v2: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_status: string;
          p_ttl_days: number;
        };
        Returns: unknown;
      };
      admin_list_roles_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_maps_provider_capability_list_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_maps_provider_capability_set_v1: {
        Args: {
          p_capability: string;
          p_enabled: boolean;
          p_note: string;
          p_provider_code: string;
          p_unit_label: string;
        };
        Returns: undefined;
      };
      admin_maps_provider_health_list_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_maps_provider_health_reset_v1: {
        Args: {
          p_capability: string;
          p_provider_code: string;
        };
        Returns: undefined;
      };
      admin_maps_provider_list_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_maps_provider_list_v2: {
        Args: {
        };
        Returns: unknown;
      };
      admin_maps_provider_set_v1: {
        Args: {
          p_enabled: boolean;
          p_language: string;
          p_monthly_hard_cap_units: number;
          p_monthly_soft_cap_units: number;
          p_note: string;
          p_priority: number;
          p_provider_code: string;
          p_region: string;
        };
        Returns: undefined;
      };
      admin_maps_provider_set_v2: {
        Args: {
          p_cache_enabled: boolean;
          p_cache_ttl_seconds: number;
          p_enabled: boolean;
          p_language: string;
          p_monthly_hard_cap_units: number;
          p_monthly_soft_cap_units: number;
          p_note: string;
          p_priority: number;
          p_provider_code: string;
          p_region: string;
        };
        Returns: undefined;
      };
      admin_maps_requests_list_v1: {
        Args: {
          p_capability: string;
          p_limit: unknown;
          p_provider_code: string;
        };
        Returns: unknown;
      };
      admin_maps_requests_list_v2: {
        Args: {
          p_capability: string;
          p_limit: unknown;
          p_provider_code: string;
        };
        Returns: unknown;
      };
      admin_maps_requests_stats_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_mark_stale_drivers_offline: {
        Args: {
          p_limit: number;
          p_stale_after_seconds: number;
        };
        Returns: number;
      };
      admin_merchant_commission_clear_v1: {
        Args: {
          p_merchant_id: string;
        };
        Returns: undefined;
      };
      admin_merchant_commission_clear_v2: {
        Args: {
          p_merchant_id: string;
        };
        Returns: undefined;
      };
      admin_merchant_commission_list_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      admin_merchant_commission_list_v2: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      admin_merchant_commission_set_v1: {
        Args: {
          p_flat_fee_iqd: number;
          p_merchant_id: string;
          p_rate_bps: number;
        };
        Returns: undefined;
      };
      admin_merchant_commission_set_v2: {
        Args: {
          p_cod_handling_flat_fee_iqd: number;
          p_cod_handling_rate_bps: number;
          p_flat_fee_iqd: number;
          p_merchant_id: string;
          p_rate_bps: number;
        };
        Returns: undefined;
      };
      admin_merchant_get_v1: {
        Args: {
          p_merchant_id: string;
        };
        Returns: Json;
      };
      admin_merchant_promotions_list_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_only_active: boolean;
          p_q: string;
        };
        Returns: unknown;
      };
      admin_merchants_list_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_q: string;
          p_status: string;
        };
        Returns: unknown;
      };
      admin_my_roles: {
        Args: {
        };
        Returns: string[];
      };
      admin_order_get_v1: {
        Args: {
          p_order_id: string;
        };
        Returns: Json;
      };
      admin_order_set_status_v1: {
        Args: {
          p_new_status: Database['public']['Enums']['merchant_order_status'];
          p_note: string;
          p_order_id: string;
        };
        Returns: unknown;
      };
      admin_orders_list_v1: {
        Args: {
          p_limit: number;
          p_merchant_id: string;
          p_offset: number;
          p_q: string;
          p_status: string;
        };
        Returns: unknown;
      };
      admin_permissions: {
        Args: {
        };
        Returns: string[];
      };
      admin_platform_fee_list_v1: {
        Args: {
          p_only_active: boolean;
        };
        Returns: unknown;
      };
      admin_platform_fee_set_v1: {
        Args: {
          p_active: boolean;
          p_flat_fee_iqd: number;
          p_product_code: string;
          p_rate_bps: number;
          p_service_area_id: string;
        };
        Returns: string;
      };
      admin_reconciliation_daily_v1: {
        Args: {
          p_days: number;
        };
        Returns: unknown;
      };
      admin_record_ride_refund: {
        Args: {
          p_reason: string;
          p_refund_amount_iqd: number;
          p_ride_id: string;
        };
        Returns: Json;
      };
      admin_record_ride_refund_v2: {
        Args: {
          p_idempotency_key: string;
          p_reason: string;
          p_refund_amount_iqd: number;
          p_ride_id: string;
        };
        Returns: Json;
      };
      admin_referral_campaigns_list_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_reject_role_change_request_v1: {
        Args: {
          p_note: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      admin_release_stuck_reserved_drivers: {
        Args: {
          p_limit: number;
          p_stale_after_seconds: number;
        };
        Returns: number;
      };
      admin_revoke_user: {
        Args: {
          p_note: string;
          p_user: string;
        };
        Returns: undefined;
      };
      admin_revoke_user_v1: {
        Args: {
          p_note: string;
          p_user: string;
        };
        Returns: Json;
      };
      admin_ridecheck_escalate: {
        Args: {
          p_event_id: string;
          p_note: string;
        };
        Returns: string;
      };
      admin_ridecheck_resolve: {
        Args: {
          p_event_id: string;
          p_note: string;
        };
        Returns: boolean;
      };
      admin_role_keys_have_permission: {
        Args: {
          p_permission: string;
          p_role_keys: string[];
        };
        Returns: boolean;
      };
      admin_service_area_delete_v1: {
        Args: {
          p_id: string;
        };
        Returns: undefined;
      };
      admin_service_area_get_v1: {
        Args: {
          p_id: string;
        };
        Returns: unknown;
      };
      admin_service_area_upsert_v1: {
        Args: {
          p_cash_rounding_step_iqd: number;
          p_driver_loc_stale_after_seconds: number;
          p_geojson: Json;
          p_governorate: string;
          p_id: string;
          p_is_active: boolean;
          p_match_radius_m: number;
          p_min_base_fare_iqd: number;
          p_name: string;
          p_pricing_config_id: string;
          p_priority: number;
          p_surge_multiplier: number;
          p_surge_reason: string;
        };
        Returns: string;
      };
      admin_service_areas_list_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_q: string;
        };
        Returns: unknown;
      };
      admin_set_default_pricing_config_v1: {
        Args: {
          p_id: string;
        };
        Returns: undefined;
      };
      admin_set_merchant_promotion_active_v1: {
        Args: {
          p_id: string;
          p_is_active: boolean;
          p_note: string;
        };
        Returns: unknown;
      };
      admin_set_merchant_status: {
        Args: {
          p_merchant_id: string;
          p_note: string;
          p_status: Database['public']['Enums']['merchant_status'];
        };
        Returns: unknown;
      };
      admin_set_merchant_status_v1: {
        Args: {
          p_merchant_id: string;
          p_new_status: Database['public']['Enums']['merchant_status'];
          p_note: string;
        };
        Returns: unknown;
      };
      admin_set_user_roles_v1: {
        Args: {
          p_note: string;
          p_role_keys: string[];
          p_user: string;
        };
        Returns: Json;
      };
      admin_settlement_approve_payment_request_v1: {
        Args: {
          p_admin_note: string;
          p_reference_override: string;
          p_request_id: string;
        };
        Returns: unknown;
      };
      admin_settlement_approve_payout_request_v1: {
        Args: {
          p_admin_note: string;
          p_reference_override: string;
          p_request_id: string;
        };
        Returns: unknown;
      };
      admin_settlement_list_accounts_v1: {
        Args: {
          p_limit: number;
          p_min_abs_balance_iqd: number;
          p_offset: number;
          p_only_negative: boolean;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
        };
        Returns: unknown;
      };
      admin_settlement_list_entries_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
        };
        Returns: unknown;
      };
      admin_settlement_list_payment_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_status: Database['public']['Enums']['settlement_request_status'];
        };
        Returns: unknown;
      };
      admin_settlement_list_payout_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_status: Database['public']['Enums']['settlement_request_status'];
        };
        Returns: unknown;
      };
      admin_settlement_record_payout_v1: {
        Args: {
          p_amount_iqd: number;
          p_idempotency_key: string;
          p_method: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_reference: string;
        };
        Returns: string;
      };
      admin_settlement_record_payout_v2: {
        Args: {
          p_agent_id: string;
          p_amount_iqd: number;
          p_day: string;
          p_idempotency_key: string;
          p_method: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_reference: string;
        };
        Returns: unknown;
      };
      admin_settlement_record_receipt_v1: {
        Args: {
          p_amount_iqd: number;
          p_idempotency_key: string;
          p_method: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_reference: string;
        };
        Returns: unknown;
      };
      admin_settlement_record_receipt_v2: {
        Args: {
          p_agent_id: string;
          p_amount_iqd: number;
          p_day: string;
          p_idempotency_key: string;
          p_method: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_reference: string;
        };
        Returns: unknown;
      };
      admin_settlement_reject_payment_request_v1: {
        Args: {
          p_admin_note: string;
          p_request_id: string;
        };
        Returns: unknown;
      };
      admin_settlement_reject_payout_request_v1: {
        Args: {
          p_admin_note: string;
          p_request_id: string;
        };
        Returns: unknown;
      };
      admin_settlement_statement_entries_v1: {
        Args: {
          p_end: string;
          p_limit: number;
          p_offset: number;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_start: string;
        };
        Returns: unknown;
      };
      admin_settlement_statement_summary_v1: {
        Args: {
          p_end: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_start: string;
        };
        Returns: unknown;
      };
      admin_support_article_get_v1: {
        Args: {
          p_id: string;
        };
        Returns: Json;
      };
      admin_support_article_upsert_v1: {
        Args: {
          p_body_md: string;
          p_enabled: boolean;
          p_id: string;
          p_section_id: string;
          p_slug: string;
          p_summary: string;
          p_tags: string[];
          p_title: string;
        };
        Returns: Json;
      };
      admin_support_articles_list_v1: {
        Args: {
          p_enabled: boolean;
          p_limit: number;
          p_offset: number;
          p_q: string;
          p_section_id: string;
        };
        Returns: unknown;
      };
      admin_support_section_upsert_v1: {
        Args: {
          p_enabled: boolean;
          p_id: string;
          p_key: string;
          p_sort_order: number;
          p_title: string;
        };
        Returns: Json;
      };
      admin_support_sections_list_v1: {
        Args: {
        };
        Returns: unknown;
      };
      admin_support_ticket_add_internal_note_v1: {
        Args: {
          p_note: string;
          p_ticket_id: string;
        };
        Returns: Json;
      };
      admin_support_ticket_assign_v1: {
        Args: {
          p_assigned_to: string;
          p_note: string;
          p_ticket_id: string;
        };
        Returns: Json;
      };
      admin_support_ticket_get_v1: {
        Args: {
          p_ticket_id: string;
        };
        Returns: Json;
      };
      admin_support_ticket_post_message_v1: {
        Args: {
          p_attachments: Json;
          p_message: string;
          p_ticket_id: string;
        };
        Returns: Json;
      };
      admin_support_ticket_set_status_v1: {
        Args: {
          p_note: string;
          p_status: Database['public']['Enums']['support_ticket_status'];
          p_ticket_id: string;
        };
        Returns: Json;
      };
      admin_support_tickets_list_v1: {
        Args: {
          p_assigned_to: string;
          p_limit: number;
          p_offset: number;
          p_priority: string;
          p_q: string;
          p_status: string;
        };
        Returns: unknown;
      };
      admin_throttle_action_v1: {
        Args: {
          p_action_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: undefined;
      };
      admin_update_pricing_config_caps: {
        Args: {
          p_id: string;
          p_max_surge_multiplier: number;
        };
        Returns: undefined;
      };
      admin_update_referral_campaign_v1: {
        Args: {
          p_active: boolean;
          p_key: string;
          p_referred_reward_iqd: number;
          p_referrer_reward_iqd: number;
        };
        Returns: unknown;
      };
      admin_update_ride_incident: {
        Args: {
          p_assigned_to: string;
          p_incident_id: string;
          p_resolution_note: string;
          p_status: Database['public']['Enums']['incident_status'];
        };
        Returns: undefined;
      };
      admin_upsert_service_area_geojson_v1: {
        Args: {
          p_cash_rounding_step_iqd: number;
          p_geojson: Json;
          p_governorate: string;
          p_is_active: boolean;
          p_min_base_fare_iqd: number;
          p_name: string;
          p_pricing_config_id: string;
          p_priority: number;
          p_surge_multiplier: number;
          p_surge_reason: string;
        };
        Returns: string;
      };
      admin_void_gift_code_v1: {
        Args: {
          p_code: string;
          p_reason: string;
        };
        Returns: unknown;
      };
      admin_wallet_integrity_snapshot: {
        Args: {
          p_hold_age_seconds: number;
          p_limit: number;
          p_topup_age_seconds: number;
        };
        Returns: Json;
      };
      admin_withdraw_approve: {
        Args: {
          p_note: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      admin_withdraw_mark_paid: {
        Args: {
          p_payout_reference: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      admin_withdraw_reject: {
        Args: {
          p_note: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      apply_rating_aggregate: {
        Args: {
        };
        Returns: unknown;
      };
      apply_referral_rewards: {
        Args: {
          p_referred_id: string;
          p_ride_id: string;
        };
        Returns: undefined;
      };
      cancel_ride_request: {
        Args: {
          p_request_id: string;
        };
        Returns: Json;
      };
      check_destination_lock: {
        Args: {
          p_rider_id: string;
        };
        Returns: boolean;
      };
      create_receipt_from_payment: {
        Args: {
        };
        Returns: unknown;
      };
      create_ride_incident: {
        Args: {
          p_category: string;
          p_description: string;
          p_ride_id: string;
          p_severity: Database['public']['Enums']['incident_severity'];
        };
        Returns: string;
      };
      customer_addresses_enforce_single_default: {
        Args: {
        };
        Returns: unknown;
      };
      dispatch_accept_ride: {
        Args: {
          p_driver_id: string;
          p_request_id: string;
        };
        Returns: unknown;
      };
      dispatch_accept_ride_user: {
        Args: {
          p_request_id: string;
        };
        Returns: unknown;
      };
      dispatch_match_ride: {
        Args: {
          p_limit_n: number;
          p_match_ttl_seconds: number;
          p_radius_m: number;
          p_request_id: string;
          p_rider_id: string;
          p_stale_after_seconds: number;
        };
        Returns: unknown;
      };
      dispatch_match_ride_user: {
        Args: {
          p_limit_n: number;
          p_match_ttl_seconds: number;
          p_radius_m: number;
          p_request_id: string;
          p_stale_after_seconds: number;
        };
        Returns: unknown;
      };
      driver_claim_order_delivery: {
        Args: {
          p_delivery_id: string;
        };
        Returns: unknown;
      };
      driver_hotspots_v1: {
        Args: {
          p_grid_m: number;
          p_hours: number;
          p_limit: number;
          p_service_area_id: string;
        };
        Returns: unknown;
      };
      driver_leaderboard_refresh_day: {
        Args: {
          p_day: string;
        };
        Returns: undefined;
      };
      driver_location_upsert_user_v1: {
        Args: {
          p_accuracy_m: number;
          p_heading: number;
          p_lat: number;
          p_lng: number;
          p_speed_mps: number;
          p_vehicle_type: string;
        };
        Returns: Json;
      };
      driver_settlement_get_my_account_v1: {
        Args: {
        };
        Returns: unknown;
      };
      driver_settlement_list_entries_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      driver_settlement_list_payment_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      driver_settlement_list_payout_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      driver_settlement_request_payment_v1: {
        Args: {
          p_amount_iqd: number;
          p_idempotency_key: string;
          p_method: string;
          p_reference: string;
        };
        Returns: unknown;
      };
      driver_settlement_request_payout_v1: {
        Args: {
          p_amount_iqd: number;
          p_idempotency_key: string;
          p_method: string;
          p_reference: string;
        };
        Returns: unknown;
      };
      driver_settlement_statement_entries_v1: {
        Args: {
          p_end: string;
          p_limit: number;
          p_offset: number;
          p_start: string;
        };
        Returns: unknown;
      };
      driver_settlement_statement_summary_v1: {
        Args: {
          p_end: string;
          p_start: string;
        };
        Returns: unknown;
      };
      driver_stats_rollup_day: {
        Args: {
          p_day: string;
        };
        Returns: undefined;
      };
      drivers_force_id_from_auth_uid: {
        Args: {
        };
        Returns: unknown;
      };
      drivers_nearby_user_v1: {
        Args: {
          p_limit_n: number;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_radius_m: number;
          p_request_id: string;
          p_required_capacity: number;
          p_stale_after_s: number;
        };
        Returns: Json;
      };
      drivers_prevent_available_with_active_match: {
        Args: {
        };
        Returns: unknown;
      };
      edge_webhook_outbox_claim: {
        Args: {
          p_limit: number;
          p_lock_id: string;
        };
        Returns: unknown;
      };
      edge_webhook_outbox_mark: {
        Args: {
          p_error: string;
          p_http_status: number;
          p_lock_id: string;
          p_outbox_id: number;
          p_retry_seconds: number;
          p_status: string;
        };
        Returns: undefined;
      };
      edge_webhook_outbox_prune: {
        Args: {
          p_batch: number;
          p_max_age_days: number;
        };
        Returns: number;
      };
      enqueue_notification_outbox: {
        Args: {
        };
        Returns: unknown;
      };
      ensure_referral_code: {
        Args: {
          p_user_id: string;
        };
        Returns: string;
      };
      ensure_wallet_account: {
        Args: {
        };
        Returns: unknown;
      };
      expire_matched_ride_requests_v1: {
        Args: {
          p_limit: number;
        };
        Returns: number;
      };
      family_accept_invite: {
        Args: {
          p_invite_token: string;
        };
        Returns: unknown;
      };
      family_create: {
        Args: {
          p_name: string;
        };
        Returns: unknown;
      };
      family_invite_teen: {
        Args: {
          p_family_id: string;
          p_invite_email: string;
          p_invite_token: string;
        };
        Returns: unknown;
      };
      family_update_policy: {
        Args: {
          p_allowed_hours: Json;
          p_destination_lock_enabled: boolean;
          p_family_id: string;
          p_geofence_allowlist: Json;
          p_pickup_pin_enabled: boolean;
          p_spend_cap_daily: number;
          p_teen_user_id: string;
        };
        Returns: unknown;
      };
      fraud_attach_event_to_case: {
        Args: {
          p_case_id: string;
          p_event_id: string;
        };
        Returns: undefined;
      };
      fraud_close_case: {
        Args: {
          p_case_id: string;
          p_closed_by: string;
          p_notes: string;
        };
        Returns: undefined;
      };
      fraud_enforce_action: {
        Args: {
          p_action_type: string;
          p_expires_at: string;
          p_metadata: Json;
          p_reason: string;
          p_severity: number;
          p_subject_key: string;
          p_subject_kind: Database['public']['Enums']['fraud_subject_kind'];
        };
        Returns: unknown;
      };
      fraud_expire_actions: {
        Args: {
        };
        Returns: number;
      };
      fraud_find_collusion_candidates: {
        Args: {
          p_max_trip_distance_m: number;
          p_min_count: number;
          p_since: unknown;
        };
        Returns: unknown;
      };
      fraud_find_route_deviation_candidates: {
        Args: {
          p_min_streak: number;
          p_seen_since: unknown;
        };
        Returns: unknown;
      };
      fraud_get_active_action: {
        Args: {
          p_action_type: string;
          p_subject_key: string;
          p_subject_kind: Database['public']['Enums']['fraud_subject_kind'];
        };
        Returns: unknown;
      };
      fraud_has_active_action: {
        Args: {
          p_action_type: string;
          p_subject_key: string;
          p_subject_kind: Database['public']['Enums']['fraud_subject_kind'];
        };
        Returns: boolean;
      };
      fraud_log_event: {
        Args: {
          p_dedupe_key: string;
          p_device_hash: string;
          p_ip_prefix: string;
          p_metadata: Json;
          p_reason: string;
          p_score: number;
          p_severity: number;
          p_subject_key: string;
          p_subject_kind: Database['public']['Enums']['fraud_subject_kind'];
        };
        Returns: unknown;
      };
      fraud_open_case: {
        Args: {
          p_metadata: Json;
          p_opened_by: string;
          p_reason: string;
          p_severity: number;
          p_subject_key: string;
          p_subject_kind: Database['public']['Enums']['fraud_subject_kind'];
        };
        Returns: unknown;
      };
      fraud_resolve_action: {
        Args: {
          p_action_id: string;
          p_notes: string;
          p_resolved_by: string;
        };
        Returns: undefined;
      };
      geo_cache_get_v1: {
        Args: {
          p_cache_key: string;
        };
        Returns: Json;
      };
      geo_cache_put_v1: {
        Args: {
          p_cache_key: string;
          p_capability: string;
          p_provider_code: string;
          p_response: Json;
          p_ttl_seconds: unknown;
        };
        Returns: undefined;
      };
      get_active_shift: {
        Args: {
          p_driver_id: string;
        };
        Returns: unknown;
      };
      get_applicable_pricing_rules: {
        Args: {
          p_region: string;
          p_subtotal_iqd: number;
          p_user_id: string;
        };
        Returns: unknown;
      };
      get_assigned_driver: {
        Args: {
          p_ride_id: string;
        };
        Returns: unknown;
      };
      get_driver_leaderboard: {
        Args: {
          p_limit: number;
          p_period: Database['public']['Enums']['driver_rank_period'];
          p_period_start: string;
        };
        Returns: unknown;
      };
      get_guardian_trip_info: {
        Args: {
          p_guardian_id: string;
          p_trip_id: string;
        };
        Returns: unknown;
      };
      get_live_activity_throttle_config: {
        Args: {
          p_platform: Database['public']['Enums']['live_activity_platform'];
        };
        Returns: unknown;
      };
      get_my_app_context: {
        Args: {
        };
        Returns: unknown;
      };
      get_nearby_hotspots: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_radius_km: number;
        };
        Returns: unknown;
      };
      get_today_forecast: {
        Args: {
          p_zone_id: string;
        };
        Returns: unknown;
      };
      get_user_membership: {
        Args: {
          p_user_id: string;
        };
        Returns: unknown;
      };
      get_user_passkeys: {
        Args: {
          p_user_id: string;
        };
        Returns: unknown;
      };
      guard_profiles_sensitive_update: {
        Args: {
        };
        Returns: unknown;
      };
      guardian_trip_track_user_v1: {
        Args: {
          p_trip_id: string;
        };
        Returns: Json;
      };
      handle_new_user: {
        Args: {
        };
        Returns: unknown;
      };
      is_admin: {
        Args: {
        };
        Returns: boolean;
      };
      is_pickup_pin_required_v1: {
        Args: {
          p_driver_id: string;
          p_rider_id: string;
        };
        Returns: boolean;
      };
      maps_pick_provider_v1: {
        Args: {
          p_capability: string;
          p_exclude: string[];
        };
        Returns: string;
      };
      maps_pick_provider_v2: {
        Args: {
          p_capability: string;
          p_exclude: string[];
        };
        Returns: string;
      };
      maps_pick_provider_v3: {
        Args: {
          p_capability: string;
          p_exclude: string[];
        };
        Returns: string;
      };
      maps_pick_provider_v4: {
        Args: {
          p_capability: string;
          p_exclude: string[];
        };
        Returns: string;
      };
      maps_provider_health_on_failure_v1: {
        Args: {
          p_base_cooldown_seconds: unknown;
          p_capability: string;
          p_error_code: string;
          p_http_status: unknown;
          p_provider_code: string;
        };
        Returns: undefined;
      };
      maps_provider_health_on_success_v1: {
        Args: {
          p_capability: string;
          p_provider_code: string;
        };
        Returns: undefined;
      };
      maps_usage_increment_v1: {
        Args: {
          p_capability: string;
          p_provider_code: string;
          p_units: number;
        };
        Returns: undefined;
      };
      merchant_best_promo: {
        Args: {
          p_merchant_id: string;
          p_price_iqd: number;
          p_product_id: string;
        };
        Returns: unknown;
      };
      merchant_chat_get_or_create_thread: {
        Args: {
          p_merchant_id: string;
        };
        Returns: string;
      };
      merchant_chat_list_messages: {
        Args: {
          p_before_created_at: string;
          p_before_id: string;
          p_limit: number;
          p_thread_id: string;
        };
        Returns: unknown;
      };
      merchant_chat_mark_read: {
        Args: {
          p_thread_id: string;
        };
        Returns: undefined;
      };
      merchant_chat_notify_new_message: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_chat_touch_thread: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_cod_handling_fee_compute_iqd: {
        Args: {
          p_goods_amount_iqd: number;
          p_merchant_id: string;
        };
        Returns: number;
      };
      merchant_commission_compute_iqd: {
        Args: {
          p_goods_amount_iqd: number;
          p_merchant_id: string;
        };
        Returns: number;
      };
      merchant_order_cod_settlement_after: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_order_create: {
        Args: {
          p_address_id: string;
          p_customer_note: string;
          p_items: Json;
          p_merchant_id: string;
        };
        Returns: string;
      };
      merchant_order_delivery_audit_after: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_order_delivery_guard: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_order_get_or_create_chat_thread: {
        Args: {
          p_order_id: string;
        };
        Returns: string;
      };
      merchant_order_request_delivery: {
        Args: {
          p_order_id: string;
        };
        Returns: string;
      };
      merchant_order_set_status: {
        Args: {
          p_merchant_note: string;
          p_order_id: string;
          p_status: Database['public']['Enums']['merchant_order_status'];
        };
        Returns: undefined;
      };
      merchant_order_status_events_on_insert: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_order_status_events_on_status_change: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_orders_guard: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_settlement_get_my_account_v1: {
        Args: {
        };
        Returns: unknown;
      };
      merchant_settlement_list_entries_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      merchant_settlement_list_payment_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      merchant_settlement_list_payout_requests_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
        };
        Returns: unknown;
      };
      merchant_settlement_request_payment_v1: {
        Args: {
          p_amount_iqd: number;
          p_idempotency_key: string;
          p_method: string;
          p_reference: string;
        };
        Returns: unknown;
      };
      merchant_settlement_request_payout_v1: {
        Args: {
          p_amount_iqd: number;
          p_idempotency_key: string;
          p_method: string;
          p_reference: string;
        };
        Returns: unknown;
      };
      merchant_settlement_statement_entries_v1: {
        Args: {
          p_end: string;
          p_limit: number;
          p_offset: number;
          p_start: string;
        };
        Returns: unknown;
      };
      merchant_settlement_statement_summary_v1: {
        Args: {
          p_end: string;
          p_start: string;
        };
        Returns: unknown;
      };
      merchants_audit_status_change: {
        Args: {
        };
        Returns: unknown;
      };
      merchants_guard_status: {
        Args: {
        };
        Returns: unknown;
      };
      nearby_available_drivers_v1: {
        Args: {
          p_limit: number;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_radius_m: number;
          p_stale_after_s: number;
        };
        Returns: unknown;
      };
      nearby_available_drivers_v2: {
        Args: {
          p_limit: number;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_radius_m: number;
          p_required_capacity: number;
          p_stale_after_s: number;
        };
        Returns: Json;
      };
      normalize_iraq_phone_e164: {
        Args: {
          p_phone: string;
        };
        Returns: string;
      };
      notification_outbox_claim: {
        Args: {
          p_limit: number;
          p_lock_id: string;
        };
        Returns: unknown;
      };
      notification_outbox_mark: {
        Args: {
          p_error: string;
          p_outbox_id: number;
          p_retry_seconds: number;
          p_status: Database['public']['Enums']['outbox_status'];
        };
        Returns: undefined;
      };
      notify_merchant_order_created: {
        Args: {
        };
        Returns: unknown;
      };
      notify_merchant_order_status_changed: {
        Args: {
        };
        Returns: unknown;
      };
      notify_user: {
        Args: {
          p_body: string;
          p_data: Json;
          p_kind: string;
          p_title: string;
          p_user_id: string;
        };
        Returns: string;
      };
      notify_users_bulk: {
        Args: {
          p_body: string;
          p_data: Json;
          p_kind: string;
          p_title: string;
          p_user_ids: string[];
        };
        Returns: number;
      };
      on_ride_completed_side_effects: {
        Args: {
        };
        Returns: unknown;
      };
      on_ride_completed_v1: {
        Args: {
          p_ride_id: string;
        };
        Returns: undefined;
      };
      ops_db_conn_stats: {
        Args: {
        };
        Returns: unknown;
      };
      ops_metric_latency_summary_v1: {
        Args: {
          p_limit: number;
          p_since: string;
        };
        Returns: unknown;
      };
      passkey_register: {
        Args: {
          p_backup_eligible: boolean;
          p_backup_state: boolean;
          p_credential_id: unknown;
          p_device_type: string;
          p_friendly_name: string;
          p_passkey_type: string;
          p_public_key: unknown;
          p_transports: string[];
          p_user_agent: string;
          p_user_id: string;
          p_webauthn_device_type: string;
        };
        Returns: string;
      };
      passkey_revoke: {
        Args: {
          p_passkey_id: string;
          p_reason: string;
        };
        Returns: boolean;
      };
      passkey_update_sign_count: {
        Args: {
          p_credential_id: unknown;
          p_new_sign_count: number;
        };
        Returns: boolean;
      };
      payout_claim_jobs: {
        Args: {
          p_limit: number;
          p_lock_seconds: number;
        };
        Returns: unknown;
      };
      payout_provider_jobs_set_idem: {
        Args: {
        };
        Returns: unknown;
      };
      payout_provider_jobs_touch: {
        Args: {
        };
        Returns: unknown;
      };
      platform_fee_compute_iqd: {
        Args: {
          p_fare_iqd: number;
          p_product_code: string;
          p_service_area_id: string;
        };
        Returns: number;
      };
      profile_kyc_init: {
        Args: {
        };
        Returns: unknown;
      };
      profiles_guard_active_role: {
        Args: {
        };
        Returns: unknown;
      };
      rate_limit_consume: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: unknown;
      };
      rate_limit_prune: {
        Args: {
          p_grace_seconds: number;
        };
        Returns: number;
      };
      redeem_gift_code: {
        Args: {
          p_code: string;
        };
        Returns: unknown;
      };
      referral_apply_code: {
        Args: {
          p_code: string;
        };
        Returns: unknown;
      };
      referral_apply_rewards_for_ride: {
        Args: {
          p_ride_id: string;
        };
        Returns: undefined;
      };
      referral_claim: {
        Args: {
          p_code: string;
        };
        Returns: Json;
      };
      referral_code_init: {
        Args: {
        };
        Returns: unknown;
      };
      referral_generate_code: {
        Args: {
        };
        Returns: string;
      };
      referral_on_ride_completed: {
        Args: {
        };
        Returns: unknown;
      };
      referral_status: {
        Args: {
        };
        Returns: Json;
      };
      refresh_driver_rank_snapshots: {
        Args: {
          p_limit: number;
          p_period: Database['public']['Enums']['driver_rank_period'];
          p_period_start: string;
        };
        Returns: undefined;
      };
      resolve_service_area: {
        Args: {
          p_lat: number;
          p_lng: number;
        };
        Returns: unknown;
      };
      revoke_trip_share_tokens_on_ride_end: {
        Args: {
        };
        Returns: unknown;
      };
      ride_chat_get_or_create_thread: {
        Args: {
          p_ride_id: string;
        };
        Returns: string;
      };
      ride_chat_list_user_v1: {
        Args: {
          p_before: string;
          p_limit: number;
          p_ride_id: string;
        };
        Returns: Json;
      };
      ride_chat_mark_read: {
        Args: {
          p_last_read_at: string;
          p_last_read_message_id: string;
          p_ride_id: string;
        };
        Returns: Json;
      };
      ride_chat_notify_on_message: {
        Args: {
        };
        Returns: unknown;
      };
      ride_chat_send_message: {
        Args: {
          p_attachment_bucket: string;
          p_attachment_key: string;
          p_kind: Database['public']['Enums']['chat_message_type'];
          p_message_id: string;
          p_metadata: Json;
          p_ride_id: string;
          p_text: string;
        };
        Returns: Json;
      };
      ride_intent_create_user_v1: {
        Args: {
          p_dropoff_address: string;
          p_dropoff_lat: number;
          p_dropoff_lng: number;
          p_intent_id: string;
          p_pickup_address: string;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_preferences: Json;
          p_product_code: string;
          p_scheduled_at: string;
          p_source: Database['public']['Enums']['ride_intent_source'];
        };
        Returns: Json;
      };
      ride_pickup_pin_mark_verified: {
        Args: {
          p_ride_id: string;
        };
        Returns: Json;
      };
      ride_pickup_pin_record_failure: {
        Args: {
          p_ride_id: string;
        };
        Returns: Json;
      };
      ride_requests_clear_match_fields: {
        Args: {
        };
        Returns: unknown;
      };
      ride_requests_release_driver_on_unmatch: {
        Args: {
        };
        Returns: unknown;
      };
      ride_requests_set_quote: {
        Args: {
        };
        Returns: unknown;
      };
      ride_requests_set_status_timestamps: {
        Args: {
        };
        Returns: unknown;
      };
      ride_verify_pickup_pin: {
        Args: {
          p_pin: string;
          p_ride_id: string;
        };
        Returns: Json;
      };
      ridecheck_open_event_v1: {
        Args: {
          p_kind: Database['public']['Enums']['ridecheck_kind'];
          p_metadata: Json;
          p_ride_id: string;
        };
        Returns: string;
      };
      ridecheck_respond_user: {
        Args: {
          p_event_id: string;
          p_note: string;
          p_response: Database['public']['Enums']['ridecheck_response'];
        };
        Returns: unknown;
      };
      ridecheck_run_v1: {
        Args: {
        };
        Returns: undefined;
      };
      safety_preferences_before_upsert: {
        Args: {
        };
        Returns: unknown;
      };
      scheduled_ride_cancel_user_v1: {
        Args: {
          p_id: string;
        };
        Returns: Json;
      };
      scheduled_ride_create_user_v1: {
        Args: {
          p_dropoff_address: string;
          p_dropoff_lat: number;
          p_dropoff_lng: number;
          p_fare_quote_id: string;
          p_payment_method: Database['public']['Enums']['ride_payment_method'];
          p_pickup_address: string;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_preferences: Json;
          p_product_code: string;
          p_scheduled_at: string;
          p_scheduled_ride_id: string;
        };
        Returns: Json;
      };
      scheduled_ride_list_user_v1: {
        Args: {
          p_limit: number;
        };
        Returns: Json;
      };
      scheduled_rides_execute_due: {
        Args: {
          p_limit: number;
        };
        Returns: number;
      };
      search_catalog_v1: {
        Args: {
          p_limit: number;
          p_merchant_id: string;
          p_query: string;
        };
        Returns: unknown;
      };
      set_my_active_role: {
        Args: {
          p_role: Database['public']['Enums']['user_role'];
        };
        Returns: undefined;
      };
      set_service_area_id_from_pickup: {
        Args: {
        };
        Returns: unknown;
      };
      set_updated_at: {
        Args: {
        };
        Returns: unknown;
      };
      set_updated_at_wallet_payout_attempts: {
        Args: {
        };
        Returns: unknown;
      };
      settlement_post_entry: {
        Args: {
          p_delta_iqd: number;
          p_idempotency_key: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_reason: string;
          p_ref_id: string;
          p_ref_type: string;
        };
        Returns: unknown;
      };
      settlement_statement_entries_v1: {
        Args: {
          p_end: string;
          p_limit: number;
          p_offset: number;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_start: string;
        };
        Returns: unknown;
      };
      settlement_statement_summary_v1: {
        Args: {
          p_end: string;
          p_party_id: string;
          p_party_type: Database['public']['Enums']['settlement_party_type'];
          p_start: string;
        };
        Returns: unknown;
      };
      st_dwithin: {
        Args: {
        };
        Returns: boolean;
      };
      submit_ride_rating: {
        Args: {
          p_comment: string;
          p_rating: number;
          p_ride_id: string;
        };
        Returns: string;
      };
      support_article_get_public_v1: {
        Args: {
          p_slug: string;
        };
        Returns: Json;
      };
      support_articles_list_public_v1: {
        Args: {
        };
        Returns: Json;
      };
      support_categories_list_user_v1: {
        Args: {
        };
        Returns: Json;
      };
      support_ticket_create_user_v1: {
        Args: {
          p_category_code: string;
          p_category_key: string;
          p_message: string;
          p_priority: Database['public']['Enums']['support_ticket_priority'];
          p_ride_id: string;
          p_role_context: Database['public']['Enums']['user_role'];
          p_subject: string;
        };
        Returns: Json;
      };
      support_ticket_get_user_v1: {
        Args: {
          p_ticket_id: string;
        };
        Returns: Json;
      };
      support_ticket_list_user_v1: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_status: string;
        };
        Returns: Json;
      };
      support_ticket_post_message_user_v1: {
        Args: {
          p_attachments: Json;
          p_message: string;
          p_ticket_id: string;
        };
        Returns: Json;
      };
      support_ticket_touch_updated_at: {
        Args: {
        };
        Returns: unknown;
      };
      sync_profile_kyc_from_submission: {
        Args: {
        };
        Returns: unknown;
      };
      sync_public_profile: {
        Args: {
        };
        Returns: unknown;
      };
      system_withdraw_mark_failed: {
        Args: {
          p_error_message: string;
          p_provider_payload: Json;
          p_request_id: string;
        };
        Returns: undefined;
      };
      system_withdraw_mark_paid: {
        Args: {
          p_payout_reference: string;
          p_provider_payload: Json;
          p_request_id: string;
        };
        Returns: undefined;
      };
      tg__set_updated_at: {
        Args: {
        };
        Returns: unknown;
      };
      tg_profiles_normalize_iraq_phone: {
        Args: {
        };
        Returns: unknown;
      };
      tg_trusted_contacts_normalize_iraq_phone: {
        Args: {
        };
        Returns: unknown;
      };
      touch_updated_at: {
        Args: {
        };
        Returns: unknown;
      };
      transition_driver: {
        Args: {
          p_actor_id: string;
          p_driver_id: string;
          p_reason: string;
          p_to_status: Database['public']['Enums']['driver_status'];
        };
        Returns: unknown;
      };
      transition_ride_user_v1: {
        Args: {
          p_cash_change_given_iqd: number;
          p_cash_collected_amount_iqd: number;
          p_expected_version: number;
          p_ride_id: string;
          p_to_status: Database['public']['Enums']['ride_status'];
        };
        Returns: unknown;
      };
      transition_ride_v2: {
        Args: {
          p_actor_id: string;
          p_actor_type: Database['public']['Enums']['ride_actor_type'];
          p_expected_version: number;
          p_ride_id: string;
          p_to_status: Database['public']['Enums']['ride_status'];
        };
        Returns: unknown;
      };
      transition_ride_v3: {
        Args: {
          p_actor_id: string;
          p_actor_type: Database['public']['Enums']['ride_actor_type'];
          p_cash_change_given_iqd: number;
          p_cash_collected_amount_iqd: number;
          p_expected_version: number;
          p_ride_id: string;
          p_to_status: Database['public']['Enums']['ride_status'];
        };
        Returns: unknown;
      };
      trg_mct_set_last_preview: {
        Args: {
        };
        Returns: unknown;
      };
      trg_wh_interest_seed: {
        Args: {
        };
        Returns: unknown;
      };
      trg_wh_merchant_chat_autoreply: {
        Args: {
        };
        Returns: unknown;
      };
      trg_wh_notifications_dispatch: {
        Args: {
        };
        Returns: unknown;
      };
      trg_wh_promotion_notify: {
        Args: {
        };
        Returns: unknown;
      };
      trg_wh_trip_share_auto: {
        Args: {
        };
        Returns: unknown;
      };
      trip_claim_pending_broadcasts: {
        Args: {
          p_limit: number;
        };
        Returns: unknown;
      };
      trip_guardian_link_create: {
        Args: {
          p_teen_user_id: string;
          p_trip_id: string;
        };
        Returns: unknown;
      };
      trip_live_activity_get_tokens: {
        Args: {
          p_trip_id: string;
        };
        Returns: unknown;
      };
      trip_live_activity_record_push: {
        Args: {
          p_activity_id: string;
        };
        Returns: undefined;
      };
      trip_live_activity_register: {
        Args: {
          p_platform: Database['public']['Enums']['live_activity_platform'];
          p_show_full_addresses: boolean;
          p_token: string;
          p_trip_id: string;
        };
        Returns: unknown;
      };
      trip_live_activity_revoke: {
        Args: {
          p_trip_id: string;
        };
        Returns: undefined;
      };
      trip_record_status_transition: {
        Args: {
          p_distance_remaining_m: number;
          p_eta_minutes: number;
          p_new_status: string;
          p_old_status: string;
          p_trip_id: string;
        };
        Returns: unknown;
      };
      trip_share_auto_create_v1: {
        Args: {
          p_ride_id: string;
          p_rider_id: string;
          p_ttl_minutes: number;
        };
        Returns: Json;
      };
      trip_share_create_user_v1: {
        Args: {
          p_ride_id: string;
          p_ttl_minutes: number;
        };
        Returns: Json;
      };
      trip_share_view_public_v1: {
        Args: {
          p_token: string;
        };
        Returns: Json;
      };
      trusted_contact_outbox_claim: {
        Args: {
          p_limit: number;
        };
        Returns: unknown;
      };
      trusted_contact_outbox_mark: {
        Args: {
          p_error: string;
          p_outbox_id: string;
          p_status: Database['public']['Enums']['outbox_status'];
        };
        Returns: undefined;
      };
      trusted_contact_outbox_mark_v2: {
        Args: {
          p_error: string;
          p_http_status: number;
          p_outbox_id: string;
          p_provider_message_id: string;
          p_response: string;
          p_result: string;
          p_retry_in_seconds: number;
        };
        Returns: undefined;
      };
      trusted_contacts_enforce_active_limit: {
        Args: {
        };
        Returns: unknown;
      };
      try_get_vault_secret: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
      update_driver_achievements: {
        Args: {
          p_driver_id: string;
        };
        Returns: undefined;
      };
      update_receipt_on_refund: {
        Args: {
        };
        Returns: unknown;
      };
      upsert_device_token: {
        Args: {
          p_platform: Database['public']['Enums']['device_platform'];
          p_token: string;
        };
        Returns: number;
      };
      user_notifications_mark_all_read: {
        Args: {
        };
        Returns: undefined;
      };
      user_notifications_mark_read: {
        Args: {
          p_notification_id: string;
        };
        Returns: undefined;
      };
      wallet_cancel_withdraw: {
        Args: {
          p_request_id: string;
        };
        Returns: undefined;
      };
      wallet_capture_ride_hold: {
        Args: {
          p_ride_id: string;
        };
        Returns: undefined;
      };
      wallet_fail_topup: {
        Args: {
          p_failure_reason: string;
          p_intent_id: string;
          p_provider_payload: Json;
        };
        Returns: unknown;
      };
      wallet_finalize_topup: {
        Args: {
          p_intent_id: string;
          p_provider_payload: Json;
          p_provider_tx_id: string;
        };
        Returns: unknown;
      };
      wallet_get_my_account: {
        Args: {
        };
        Returns: unknown;
      };
      wallet_hold_upsert_for_ride: {
        Args: {
          p_amount_iqd: number;
          p_ride_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      wallet_holds_normalize_status: {
        Args: {
        };
        Returns: unknown;
      };
      wallet_payout_attempts_autolog_paid: {
        Args: {
        };
        Returns: unknown;
      };
      wallet_release_ride_hold: {
        Args: {
          p_ride_id: string;
        };
        Returns: undefined;
      };
      wallet_request_withdraw: {
        Args: {
          p_amount_iqd: number;
          p_destination: Json;
          p_idempotency_key: string;
          p_payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
        };
        Returns: string;
      };
      wallet_validate_withdraw_destination: {
        Args: {
          p_destination: Json;
          p_payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
        };
        Returns: undefined;
      };
      wallet_withdraw_audit_log_trigger: {
        Args: {
        };
        Returns: unknown;
      };
      webauthn_consume_challenge: {
        Args: {
          p_challenge_id: string;
        };
        Returns: boolean;
      };
      webauthn_consume_challenge_details: {
        Args: {
          p_challenge_id: string;
        };
        Returns: unknown;
      };
      webauthn_create_challenge: {
        Args: {
          p_challenge: unknown;
          p_challenge_type: string;
          p_session_id: string;
          p_user_agent: string;
          p_user_id: string;
        };
        Returns: unknown;
      };
      webhook_claim_jobs: {
        Args: {
          p_limit: number;
          p_lock_seconds: number;
        };
        Returns: unknown;
      };
    };
    CompositeTypes: {};
    Views: {};
  };
};
