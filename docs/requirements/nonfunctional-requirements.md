# Non‑Functional Requirements

## Performance
- Capture popup opens < 100ms
- Saving an entry < 50ms
- Semantic search < 200ms for typical datasets
- Clustering completes within reasonable time for < 10k entries

## Privacy
- No cloud calls
- No telemetry
- All data stored locally

## Reliability
- Background worker must not crash UI
- Database must remain consistent
- Exports must be deterministic

## Usability
- Minimal UI friction
- Keyboard‑first workflow
- Clear navigation

## Portability
- Windows first
- macOS and Linux later
