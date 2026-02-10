# Session 14 — Driver-side stickiness: smart shift planner + hotspot guidance + AI earnings coach

## Goal
Increase driver retention and supply quality without manipulative UX:

1) **Smart shift planner**: suggest best times/areas to work.
2) **Hotspot guidance**: real-time “where to go next” based on demand signals.
3) **AI earnings coach**: personalized tips and goal tracking.

## Principles
- Transparency: show why a recommendation is made and expected value ranges.
- Autonomy: recommendations are optional; no dark patterns.
- Privacy: aggregate/clip sensitive signals; strict access controls.

---

# Part A: Smart shift planner

## User stories
- “I want to earn $X this week; tell me when to drive.”
- “I only drive evenings; show best 2-hour windows.”
- “Avoid unsafe zones at night.”

## Data inputs
- Historical demand by zone/time (orders + rides)
- Supply (active drivers) and fill rates
- Weather and events (optional, later)
- Driver profile: preferred zones, hours, vehicle type, past performance

## Technical approach
- Forecasting:
  - start with simple baselines (moving averages + seasonality)
  - evolve to gradient boosted trees / time-series models (later)
- Output:
  - recommended time blocks per day
  - predicted earnings range (P25–P75)
  - confidence score

## Backend
- Nightly batch jobs compute forecasts per city/zone.
- Store in `shift_forecasts(city_id, zone_id, time_bucket, demand_score, expected_earnings_range, confidence)`.

## Frontend
- Calendar-like planner with “Add to schedule” reminders.
- Safety overlays (zones to avoid) from safety team inputs.

---

# Part B: Hotspot guidance

## UX
- Heatmap + “next best zone” CTA.
- Context:
  - “High demand near X, 10–15 min drive.”
  - “Too many drivers here; move 2 km east.”

## Real-time signals (bounded)
- Demand queue length
- Recent order/trip creation velocity
- Nearby active drivers

## Geospatial implementation
- PostGIS queries + indexes:
  - pre-bucket zones (H3/geohash) to avoid heavy computations per request
- Rate-limit driver requests for hotspot data.

## Edge cases
- Avoid “herding”:
  - add randomization and per-driver diversification
  - cap recommendations per zone

---

# Part C: AI earnings coach

## UX
- “Goals”:
  - weekly earnings target
  - hours target
- Insights:
  - “You earn 20% more on Thu 6–9pm.”
  - “Acceptance rate drops after 11pm; consider shorter late shifts.”
  - “Your avg idle time is high in zone Y; try zone Z.”

## Safety and ethics
- Avoid pressuring drivers to take unsafe rides or work excessive hours.
- Provide wellbeing nudges (breaks) and safety reminders.

## Architecture
- Feature generation pipeline from trip + driver events.
- LLM usage (if any) must:
  - be grounded in computed metrics
  - not hallucinate numbers
  - be cost-capped (budgets per driver per week)

## Data model
- `driver_goals(driver_id, goal_type, target, active_from, active_to)`
- `driver_insights(driver_id, insight_type, payload_json, created_at, expires_at)`
- `driver_recommendation_events` for auditing and A/B testing.

---

# Rollout plan
- Phase 0: shift planner (static forecasts)
- Phase 1: hotspot guidance (limited zones)
- Phase 2: earnings coach (insights only)
- Phase 3: earnings coach with optional AI narrative layer

## Acceptance criteria
- Recommendations improve retention and earnings metrics without increasing safety incidents.
- All recommendations are explainable and auditable.
- Rate limits prevent excessive load.
