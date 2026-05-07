# Neurologue Priority Model (NPM)

Neurologue computes emergent priorities from behaviour, not declarations.  
It does this by scoring themes across four axes:

- E — Energy Input  
- V — Value Alignment  
- O — Obligation Weight  
- M — Intrinsic Motivation  

These are computed at the theme level (clusters of related entries) and updated continuously.

---

## 1. Data Model Extensions

### 1.1. Theme

id: uuid  
name: string  
embedding_centroid: vector  
created_at: datetime  
updated_at: datetime  

### 1.2. ThemeMetrics (time-sliced, e.g. per 7/30 days)

id: uuid  
theme_id: uuid  
window_start: datetime  
window_end: datetime  
energy_score: float (0–1)  
value_alignment_score: float (0–1)  
obligation_score: float (0–1)  
motivation_score: float (0–1)  
priority_score: float (0–1)  
open_loops_count: int  
entries_count: int  

### 1.3. EntrySignals

entry_id: uuid  
theme_id: uuid  
length_tokens: int  
sentiment_score: float (-1 to 1)  
emotional_intensity: float (0–1)  
obligation_flag: bool  
motivation_flag: bool  
value_reference_flag: bool  
open_loop_flag: bool  

---

## 2. Signal Computation

Neurologue computes four independent signals which combine into a final priority score.

---

### 2.1. Energy Input (E)

Measures how much cognitive energy is going into a theme.

Components:  
F — normalised frequency  
R — recency weighting  
L — average length (tokens)  
I — emotional intensity  

Formula:  
E = wf·F + wr·R + wl·L + wi·I  

Weights:  
wf = 0.35  
wr = 0.25  
wl = 0.20  
wi = 0.20  

---

### 2.2. Value Alignment (V)

Measures long-term meaningfulness of a theme.

Components:  
S — cluster stability over time  
P — proportion of positive sentiment  
VR — proportion of entries referencing values  

Formula:  
V = ws·S + wp·P + wvr·VR  

Weights:  
ws = 0.5  
wp = 0.25  
wvr = 0.25  

---

### 2.3. Obligation Weight (O)

Measures external responsibility or commitments.

Components:  
OF — proportion of obligation-flagged entries  
OL — open loops  
D — deadline/time-pressure indicators  

Formula:  
O = wof·OF + wol·OL + wd·D  

Weights:  
wof = 0.5  
wol = 0.3  
wd = 0.2  

---

### 2.4. Intrinsic Motivation (M)

Measures how much you want to do this.

Components:  
MF — proportion of motivation-flagged entries  
PS — positive sentiment strength  
SP — spontaneous recurrence  

Formula:  
M = wmf·MF + wps·PS + wsp·SP  

Weights:  
wmf = 0.5  
wps = 0.25  
wsp = 0.25  

---

### 2.5. Final Priority Score

Priority = α·E + β·V + γ·O + δ·M  

Suggested weights:  
α = 0.35  
β = 0.25  
γ = 0.25  
δ = 0.15  

---

## 3. Background Processing Pipeline

### 3.1. Per-Entry Processing

When a new entry is created:

1. Assign to a theme (existing cluster or new).  
2. Run LLM classification to generate EntrySignals:  
   - sentiment_score  
   - emotional_intensity  
   - obligation_flag  
   - motivation_flag  
   - value_reference_flag  
   - open_loop_flag  
3. Persist EntrySignals.

---

### 3.2. Periodic Aggregation (e.g. hourly)

For each theme and time window:

1. Aggregate raw metrics (F, R, L, I, S, P, VR, OF, OL, D, MF, PS, SP).  
2. Compute E, V, O, M.  
3. Compute Priority.  
4. Store ThemeMetrics.

---

## 4. LLM Prompt Specifications

### 4.1. Entry Classification Prompt

System:  
You classify a single journal entry into cognitive signals. Respond with strict JSON. No explanations.

User:  
Text: "<ENTRY_TEXT>"

Extract:  
sentiment_score: float from -1 to 1  
emotional_intensity: float 0–1  
obligation_flag: true/false  
motivation_flag: true/false  
value_reference_flag: true/false  
open_loop_flag: true/false  

Output JSON:  
{  
  "sentiment_score": ...,  
  "emotional_intensity": ...,  
  "obligation_flag": ...,  
  "motivation_flag": ...,  
  "value_reference_flag": ...,  
  "open_loop_flag": ...  
}

---

## 5. UI Concepts

### 5.1. Priority Dashboard

- List of top themes  
- Mini-bars for E, V, O, M  
- Overall priority score  
- Sorting by any axis  

### 5.2. Quadrant View

Plot themes on:  
X-axis: Energy (E)  
Y-axis: Importance (V + O)  

Quadrants reveal:  
High energy + low importance → distraction  
Low energy + high importance → neglected obligations  
High energy + high importance → true priorities  
Low energy + low importance → noise  

### 5.3. Drift View

Time-series showing:  
- Energy distribution across themes  
- Rising passion projects  
- Neglected obligations  
- Shifts in value alignment  

---

## 6. GitHub Issue Templates

### Issue: Implement Priority Data Model

Description:  
Add Theme, ThemeMetrics, and EntrySignals tables. Wire into existing entry/theme system.

Acceptance Criteria:  
- DB migrations created  
- EntrySignals generated for new entries  
- ThemeMetrics can be written and queried  

---

### Issue: Implement Entry Signal Classification

Description:  
Add LLM call for EntrySignals using the defined JSON prompt. Integrate into entry ingestion pipeline.

Acceptance Criteria:  
- New entries produce EntrySignals  
- JSON parsing errors handled  
- Feature flag for classification  

---

### Issue: Implement Priority Scoring Pipeline

Description:  
Implement aggregation job to compute E, V, O, M, and Priority. Store results in ThemeMetrics.

Acceptance Criteria:  
- Job runs on schedule  
- Scores stable and normalised  
- Debug endpoint available  

---

### Issue: Build Priority Dashboard UI

Description:  
Create a new “Priorities” view showing theme scores and quadrants.

Acceptance Criteria:  
- List view with E/V/O/M bars  
- Quadrant visualisation  
- Click-through to theme details  

---

### Issue: Add Drift Analysis

Description:  
Implement time-series visualisation of theme energy and priority drift.

Acceptance Criteria:  
- Graph of energy over time  
- Highlight rising/falling themes  
- Detect neglected obligations  
