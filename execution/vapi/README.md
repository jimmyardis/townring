# Vapi assistant configs

Source of truth for the four TalkMap assistants' system prompts. Vapi itself
holds the live copy; these files exist so a prompt can never be lost again.

| City | Assistant ID | Voice |
|---|---|---|
| Chapin | `ac689a99-081e-4f4e-8d80-746e6d7daa6a` | `cedar` |
| Charleston | `bdc929fb-5dbb-43ee-84f6-8f51b26c85b9` | `echo` |
| Columbia | `eed4637f-c1f2-47f0-a896-f93c38532f1b` | `marin` |
| Sumter | `e569e4e4-4cb2-4806-a1aa-9888d2381318` | `alloy` |

Model: `openai/gpt-realtime-2025-08-28` (native speech-to-speech, no transcriber).
Realtime-compatible voices are only `alloy`, `echo`, `shimmer`, `marin`, `cedar` —
ash, ballad, coral, fable, onyx and nova are rejected.

## The trap that cost us three assistants

On 2026-05-29 a model upgrade PATCHed `model` as `{provider, model}` alone.
**Vapi replaces the whole `model` object**, so `messages` (the system prompt) and
`toolIds` were deleted from Chapin, Charleston and Columbia. Nobody noticed for
four months; those agents answered with no grounding and no ability to drive the
map. Sumter survived only because it was never re-PATCHed.

**Always read the assistant first and carry `messages` and `toolIds` forward.**
Vapi keeps version history at `GET /assistant/{id}/version` — that is how these
prompts were recovered.

## Tool routing

The 10 tools are shared by all four assistants.

- **Server-side** (`/api/vapi-tool` on chapin-talkmap-api): `get_place_info`,
  `rank_tracts`, `get_county_data`, `aggregate_tracts`,
  `get_tract_population_history`. These work on a phone call.
- **Client-side** (answered by `{city}/voice.js`): `fly_to_place`, `set_metric`,
  `scrub_year`, `toggle_layer`, `reset_view`. These drive a Mapbox canvas and
  only exist in a browser.

The server resolves which city a call is about from the **assistant id**, since a
shared tool carries no city of its own. After editing a tool, re-save the
assistants — they appear to bind the tool version current at their last save.

## Applying a prompt

    curl -X PATCH https://api.vapi.ai/assistant/$ID \
      -H "Authorization: Bearer $VAPI_PRIVATE_KEY" \
      -H "Content-Type: application/json" \
      -d @payload.json

where payload.json carries `model.messages`, `model.toolIds`, `model.provider`
and `model.model` together — never a partial `model`.

`backup-2026-09-20-pre-realtime/` holds the full configs as they were before the
realtime switch.
