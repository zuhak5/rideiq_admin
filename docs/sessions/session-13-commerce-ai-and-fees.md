# Session 13 — Commerce & delivery UX: AI food concierge + add-on store + fee transparency/membership

## Goal
Increase conversion and AOV while improving trust:

1) **AI “food concierge”** (voice + chat) inside ordering.
2) **Add-on store** after checkout (DoubleDash-style).
3) **Fee transparency** + “no-fee threshold” and/or **membership**.

## References (market precedent)
- Just Eat Takeaway.com AI Voice Assistant announcement (voice + chat concierge): https://newsroom.justeattakeaway.com/en-WW/259937-introducing-the-next-evolution-of-ordering-just-eat-takeaway-com-unveils-ai-voice-assistant/
- DoorDash DoubleDash explainer: https://help.doordash.com/consumers/s/article/DoubleDash
- DoorDash DashPass $0 delivery fees: https://help.doordash.com/consumers/s/article/What-is-DashPass
- Uber One membership benefits (including family sharing): https://www.uber.com/newsroom/membership-updates/
- Example “no-fee threshold” approach (industry): recent Grubhub policy shift (see major press coverage)

## Non-goals
- Fully autonomous ordering with no user confirmation.
- Replacing existing search/browse flows; concierge augments them.
- Shipping pricing experiments without measurement + rollback.

---

# Part A: AI “food concierge” (voice + chat)

## Core UX
- Entry points:
  - “Help me decide” button on home / restaurant page
  - voice icon in search bar
- Modes:
  - Chat: preferences, constraints, budget, dietary
  - Voice: hands-free ordering + accessibility
- Output:
  - 3–5 options with explanations (“because you said spicy, under $15…”)
  - quick actions: add to cart, swap sides, adjust spice, remove allergens
- Always require explicit user confirmation before placing an order.

## Data dependencies
- Canonical merchant + menu model with:
  - item name/description, price, allergens, availability, prep time, modifiers
- User preference model:
  - dietary, allergens, disliked ingredients, budget bands

## Architecture
- **Retrieval-first**:
  - RAG over menu + merchant metadata
  - “tool calls” to pricing/availability endpoints
- **Conversation state** stored per user session with TTL.

## Safety controls
- Prompt injection defenses:
  - strict tool whitelist
  - schema-validated responses
  - no direct execution of user-provided instructions
- Content policy:
  - refuse unsafe requests
  - avoid medical advice; allow allergen filtering and show disclaimers

## Observability
- Conversion: concierge sessions → add-to-cart → purchase
- AOV delta vs control
- Latency and error rate
- “Bad suggestion” feedback rate

## Rollout
- Start chat-only (lower complexity), then add voice.
- Gate by environment + percentage rollout.
- Add kill-switch.

---

# Part B: Add-on store after checkout (DoubleDash-style)

## Core UX
- Immediately after placing an order, show a limited-time prompt:
  - “Add items from a nearby store with the same delivery”
- Constraints:
  - short time window (e.g., 5–10 minutes)
  - merchant must be route-compatible
  - clearly communicate whether it’s “same courier / same fee” or “additional fee”

## Backend mechanics
- Create a “primary order” and allow “addon orders” linked via `bundle_id`.
- Dispatch tries to assign addon pickup to the same courier:
  - if not possible, either:
    - reject addon (best for trust), or
    - allow second courier with clear disclosure (experiment)

## Data model
- `order_bundles(bundle_id, primary_order_id, status)`
- `orders.bundle_id` nullable
- `addon_offers(order_id, offer_expires_at, eligible_merchants_json)`

## Pricing & fee logic
- Prefer “no additional delivery fee” if same courier and within constraints.
- If additional fee applies, disclose up front.

## Observability
- Offer impressions → add-on conversion
- Incremental margin
- Failure modes: addon accepted then reassigned / delayed (must be low)

---

# Part C: Fee transparency + no-fee threshold / membership

## Fee transparency requirements
- Show total price early, with breakdown:
  - delivery fee
  - service fee
  - small order fee
  - priority fee (optional)
  - taxes + tip
- Provide “why is this fee here?” tooltips.
- Keep the final price stable; avoid surprise “sticker shock”.

## No-fee threshold
- Example: waive delivery/service fees above $X subtotal (region-specific).
- Guardrails:
  - exclude taxes/tips from subtotal
  - clear eligibility rules
  - cap total subsidy per order if needed

## Membership option
- Subscription that provides:
  - $0 delivery fee on eligible orders above minimum
  - reduced service fee
  - member-exclusive promos
- Include “family sharing” as a differentiator where supported.

## Data model
- `membership_plans`, `memberships(user_id, plan_id, status, renew_at)`
- `pricing_rules` with priority + environment scoping
- `fee_disclosures` localized strings

## Rollout plan
- Phase 0: fee breakdown UI only
- Phase 1: no-fee threshold experiment (A/B)
- Phase 2: membership MVP
- Phase 3: add family sharing + partner promos

## Acceptance criteria
- Fee breakdown is consistent across all checkout surfaces.
- Threshold/membership pricing rules are auditable and testable (unit + snapshot tests).
- Experiments can be turned off instantly.
