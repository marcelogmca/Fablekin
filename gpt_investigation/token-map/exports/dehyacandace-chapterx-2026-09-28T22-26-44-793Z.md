# Fablekin Token Map Export

- Project: **dehyacandace**
- Chapter: **unknown**
- Source log: `workspace/logs/dehyacandace/turn_1790633980257.json`
- Generated: 2026-09-28T22:26:44.781Z
- Calls: **31** (measured: 30, no-usage: 1)
- Provider-reported input tokens across calls: **489,003** (cached 173,952)
- Provider-reported output tokens: **86,795** (reasoning 27,011)
- Estimated cost (local pricing, where known): **$0.1581**
- Payload rows: **95** nodes, **60** leaves.

> Reading guide: columns are LLM calls, rows are prompt components.
> `~tokens` in payload rows are span-proportional attributions of the call's
> provider input total (each byte owned exactly once); `input/output/reasoning`
> figures are exact provider-reported whole-call totals. `·` = no bytes.

## 1. Call index (columns in matrix order = heaviest input first)

| # | Call | requestId | model | provider | status | input | output | reasoning | cached | price in | price out | cache disc. | chars |
|---|------|-----------|-------|----------|--------|-------|--------|-----------|--------|----------|-----------|-------------|-------|
| 1 | Director (Ledger Async) | core.director.followup | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 64,482 | 3,976 | 2,874 | 60,416 | $0.000569 | $0.001113 | $0.007612 | 271,323 |
| 2 | Director (Analysis) | core.director.analysis | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 60,538 | 4,303 | 2,090 | 0 | $0.008475 | $0.001205 | $0 | 255,621 |
| 3 | Writer | core.writer | deepseek/deepseek-v4-pro-0813:thinking | nano_gpt | measured | 56,104 | 6,511 | 3,335 | 0 | $0.0617 | $0.0163 | $0 | 238,637 |
| 4 | Plugin:relationship_tracker | core.vn_background | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 52,695 | 1,598 | 1,380 | 39,168 | $0.001894 | $0.000447 | $0.004935 | 233,749 |
| 5 | Plugin:quest_tracker | core.vn_background | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 48,284 | 1,783 | 1,297 | 37,120 | $0.001563 | $0.000499 | $0.004677 | 208,157 |
| 6 | Plugin:personality_tracker (Batch) | core.vn_background | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 40,458 | 757 | 741 | 0 | $0.005664 | $0.000212 | $0 | 175,203 |
| 7 | Plugin:personality_tracker | core.vn_background | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 38,410 | 1,477 | 1,098 | 37,120 | $0.000181 | $0.000414 | $0.004677 | 167,452 |
| 8 | Plugin:world_state_tracker | world_state_tracker.extraction_request | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 15,041 | 1,747 | 1,112 | 0 | $0.002106 | $0.000489 | $0 | 56,825 |
| 9 | Plugin:world_location_tracker | world_location_tracker.location_update | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 11,043 | 993 | 367 | 0 | $0.001546 | $0.000278 | $0 | 42,552 |
| 10 | Smart OST Select | core.asset_selector.ost.smart_select | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 10,590 | 875 | 0 | 0 | $0.000847 | $0.000193 | $0 | 31,407 |
| 11 | Plugin:post_writer_consistency_checker:HQ:cat3_dialogue | post_writer_consistency_checker.hq_flag_cat3_dialogue | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 7,366 | 898 | 896 | 0 | $0.001031 | $0.000251 | $0 | 33,232 |
| 12 | Plugin:post_writer_consistency_checker:HQ:cat1_banned_phrases | post_writer_consistency_checker.hq_flag_cat1_banned_phrases | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 7,268 | 323 | 321 | 0 | $0.001018 | $0.00009044 | $0 | 32,826 |
| 13 | Plugin:post_writer_consistency_checker:HQ:cat2_repetition | post_writer_consistency_checker.hq_flag_cat2_repetition | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 7,248 | 1,433 | 1,259 | 0 | $0.001015 | $0.000401 | $0 | 32,948 |
| 14 | Plugin:post_writer_consistency_checker:HQ:cat5_prose | post_writer_consistency_checker.hq_flag_cat5_prose | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 7,242 | 890 | 888 | 0 | $0.001014 | $0.000249 | $0 | 32,919 |
| 15 | Plugin:post_writer_consistency_checker:HQ:cat4_familiarity | post_writer_consistency_checker.hq_flag_cat4_familiarity | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | measured | 7,117 | 659 | 657 | 0 | $0.000996 | $0.000185 | $0 | 32,322 |
| 16 | MemoryLOD Arc Compression | core.memory.arc_compression | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 6,589 | 1,632 | 0 | 0 | $0.000527 | $0.000359 | $0 | 29,639 |
| 17 | Plugin:vn_cinematographer | vn_cinematographer.cinematography_cinematographer_maintrack | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 4,867 | 4,661 | 0 | 0 | $0.000389 | $0.001025 | $0 | 17,332 |
| 18 | Plugin:vn_cinematographer | vn_cinematographer.cinematography_cinematographer_cameratrack | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 4,787 | 5,345 | 0 | 0 | $0.000383 | $0.001176 | $0 | 17,807 |
| 19 | Reaction Director | core.vn_analysis.reaction_director | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 4,494 | 6,382 | 0 | 128 | $0.000349 | $0.001404 | $0 | 17,427 |
| 20 | Select Best Background | core.asset_selector.background.basic | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 3,762 | 222 | 0 | 0 | $0.000301 | $0.00004884 | $0 | 13,765 |
| 21 | Conversation Staging Classifier | core.vn_analysis.conversation_staging | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 3,568 | 13,225 | 0 | 0 | $0.000285 | $0.002910 | $0 | 13,406 |
| 22 | Gaze Director | core.vn_analysis.gaze_director | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 3,530 | 3,535 | 0 | 0 | $0.000282 | $0.000778 | $0 | 13,008 |
| 23 | Emotion Classifier - Chunk | core.vn.emotion_chunk | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 3,488 | 3,767 | 0 | 0 | $0.000279 | $0.000829 | $0 | 12,765 |
| 24 | Plugin:post_writer_consistency_checker:HQ:corrector | post_writer_consistency_checker.hq_corrector | deepseek/deepseek-v4-pro-0813:thinking | nano_gpt | measured | 3,286 | 1,696 | 1,654 | 0 | $0.003615 | $0.004240 | $0 | 12,357 |
| 25 | MemoryLOD Arc Compression | core.memory.arc_compression | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 3,262 | 581 | 0 | 0 | $0.000261 | $0.000128 | $0 | 15,018 |
| 26 | Plugin:post_writer_consistency_checker:HQ:consistency | post_writer_consistency_checker.hq_flag_consistency | deepseek/deepseek-v4-pro-0813:thinking | nano_gpt | measured | 3,116 | 7,044 | 7,042 | 0 | $0.003428 | $0.0176 | $0 | 11,459 |
| 27 | Smart OST Filters | core.asset_selector.ost.smart_filters | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 2,745 | 2,693 | 0 | 0 | $0.000220 | $0.000592 | $0 | 9,718 |
| 28 | Emotion Classifier - Chunk | core.vn.emotion_chunk | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 2,728 | 5,289 | 0 | 0 | $0.000218 | $0.001164 | $0 | 10,024 |
| 29 | Synopsis Request | core.memory.synopsis.current_chapter | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 2,605 | 1,944 | 0 | 0 | $0.000208 | $0.000428 | $0 | 9,426 |
| 30 | Summary Request | core.memory.summary | inclusionai/ling-3.0-flash:thinking | nano_gpt | measured | 2,290 | 556 | 0 | 0 | $0.000183 | $0.000122 | $0 | 8,602 |
| 31 | Plugin:story_arc_tracker | core.vn_background | deepseek/deepseek-v4-flash-0731:thinking | nano_gpt | no-usage | — | 0 | 0 | 0 | $0 | $0 | $0 | 172,007 |

## 2. Full matrix — attributed input tokens (fully expanded)

| Payload (depth = semantic nesting) | C1 Director (Ledger Asyn… | C2 Director (Analysis) | C3 Writer | C4 Plugin:relationship_t… | C5 Plugin:quest_tracker | C6 Plugin:personality_tr… | C7 Plugin:personality_tr… | C8 Plugin:world_state_tr… | C9 Plugin:world_location… | C10 Smart OST Select | C11 Plugin:post_writer_co… | C12 Plugin:post_writer_co… | C13 Plugin:post_writer_co… | C14 Plugin:post_writer_co… | C15 Plugin:post_writer_co… | C16 MemoryLOD Arc Compres… | C17 Plugin:vn_cinematogra… | C18 Plugin:vn_cinematogra… | C19 Reaction Director | C20 Select Best Background | C21 Conversation Staging … | C22 Gaze Director | C23 Emotion Classifier - … | C24 Plugin:post_writer_co… | C25 MemoryLOD Arc Compres… | C26 Plugin:post_writer_co… | C27 Smart OST Filters | C28 Emotion Classifier - … | C29 Synopsis Request | C30 Summary Request | C31 Plugin:story_arc_trac… |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shared history ▸ | ~31,180 | ~31,071 | ~30,845 | ~22,012 | ~22,718 | ~22,547 | ~20,554 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background scene | · | · | · | ~1,811 | ~1,932 | ~1,855 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Plugin tasks ▸ | · | · | · | ~14,233 | ~8,640 | ~1,060 | ~1,118 | ~15,041 | ~11,043 | · | ~7,366 | ~7,268 | ~7,248 | ~7,242 | ~7,117 | · | ~4,867 | ~4,787 | · | · | · | · | · | ~3,286 | · | ~3,116 | · | · | · | · | ~— |
| · Extraction Request | · | · | · | · | · | · | · | ~15,041 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Relationship Change Extraction | · | · | · | ~14,233 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Location Update | · | · | · | · | · | · | · | · | ~11,043 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Story Objective Tracking | · | · | · | · | ~8,640 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat3 Dialogue ▸ | · | · | · | · | · | · | · | · | · | · | ~7,366 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | ~7,366 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat3 Dialogue | · | · | · | · | · | · | · | · | · | · | ~7,366 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat1 Banned Phrases ▸ | · | · | · | · | · | · | · | · | · | · | · | ~7,268 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | ~7,268 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat1 Banned Phrases | · | · | · | · | · | · | · | · | · | · | · | ~7,268 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat2 Repetition ▸ | · | · | · | · | · | · | · | · | · | · | · | · | ~7,248 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | ~7,248 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat2 Repetition | · | · | · | · | · | · | · | · | · | · | · | · | ~7,248 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat5 Prose ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | ~7,242 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | ~7,242 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat5 Prose | · | · | · | · | · | · | · | · | · | · | · | · | · | ~7,242 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat4 Familiarity ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~7,117 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~7,117 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat4 Familiarity | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~7,117 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Cinematography Cinematographer Maintrack ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~4,867 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Track ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~4,867 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 3 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~2,413 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~1,995 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 2 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~459 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Cinematography Cinematographer Cameratrack ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~4,787 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Track ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~4,787 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 3 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~2,310 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~1,890 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 2 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~587 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Corrector ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~3,286 | · | · | · | · | · | · | · |
| · · Corrector ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~3,286 | · | · | · | · | · | · | · |
| · · · Review Target | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~2,687 | · | · | · | · | · | · | · |
| · · · Instructions | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~599 | · | · | · | · | · | · | · |
| · Hq Flag Consistency ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~3,116 | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~3,116 | · | · | · | · | · |
| · · · Consistency ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~3,116 | · | · | · | · | · |
| · · · · Review Target | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~2,441 | · | · | · | · | · |
| · · · · Instructions | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~675 | · | · | · | · | · |
| · Personality Ledger Consolidation | · | · | · | · | · | · | ~1,118 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Personality Change Extraction | · | · | · | · | · | ~1,060 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Story Arc Classification | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| Shared canon ▸ | ~9,502 | ~9,469 | ~9,400 | ~8,998 | ~9,259 | ~9,217 | ~9,156 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Character canon ▸ | ~9,472 | ~9,439 | ~9,370 | ~8,985 | ~9,245 | ~9,203 | ~9,142 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · · Sheets | ~9,472 | ~9,439 | ~9,370 | ~8,985 | ~9,245 | ~9,203 | ~9,142 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Static lore file | ~14 | ~14 | ~14 | ~14 | ~14 | ~14 | ~14 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| Core VN calls ▸ | · | · | · | · | · | · | · | · | · | ~10,590 | · | · | · | · | · | · | · | · | ~4,494 | ~3,762 | ~3,568 | ~3,530 | ~3,488 | · | · | · | ~2,745 | ~2,728 | ~2,605 | · | · |
| · Core VN task | · | · | · | · | · | · | · | · | · | ~10,413 | · | · | · | · | · | · | · | · | ~4,358 | ~3,618 | ~1,213 | ~1,129 | · | · | · | · | ~2,596 | · | ~239 | · | · |
| · Core VN scene | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~2,215 | ~2,258 | · | · | · | · | · | · | ~2,220 | · | · |
| · Emotion classification | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~3,488 | · | · | · | · | ~2,728 | · | · | · |
| · Core VN scene capsule | · | · | · | · | · | · | · | · | · | ~94 | · | · | · | · | · | · | · | · | ~72 | ~76 | ~74 | ~75 | · | · | · | · | ~79 | · | ~77 | · | · |
| · Core VN system | · | · | · | · | · | · | · | · | · | ~84 | · | · | · | · | · | · | · | · | ~64 | ~68 | ~66 | ~67 | · | · | · | · | ~70 | · | ~69 | · | · |
| Shared dynamic knowledge ▸ | ~4,325 | ~4,310 | ~4,279 | ~4,087 | ~4,205 | ~4,186 | ~4,158 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Recalled memories ▸ | ~2,427 | ~2,418 | ~2,401 | ~2,302 | ~2,369 | ~2,358 | ~2,342 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · · Memories | ~2,427 | ~2,418 | ~2,401 | ~2,302 | ~2,369 | ~2,358 | ~2,342 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Lore entries ▸ | ~1,882 | ~1,875 | ~1,862 | ~1,785 | ~1,837 | ~1,828 | ~1,816 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · · Entries | ~1,882 | ~1,875 | ~1,862 | ~1,785 | ~1,837 | ~1,828 | ~1,816 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| Shared simulation ▸ | ~2,484 | ~2,476 | ~2,458 | ~2,339 | ~2,407 | ~2,396 | ~2,380 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · World state context ▸ | ~1,485 | ~1,480 | ~1,469 | ~1,409 | ~1,449 | ~1,443 | ~1,433 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · · Current State | ~1,467 | ~1,462 | ~1,451 | ~1,392 | ~1,432 | ~1,425 | ~1,416 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Location context ▸ | ~981 | ~978 | ~971 | ~931 | ~958 | ~953 | ~947 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · · Current State | ~963 | ~959 | ~952 | ~913 | ~940 | ~935 | ~929 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| Director protocol ▸ | ~8,124 | ~6,488 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Analysis instructions | ~6,511 | ~6,488 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Ledger instructions | ~1,613 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Core memory calls ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~6,589 | · | · | · | · | · | · | · | · | ~3,262 | · | · | · | · | ~2,290 | · |
| · Arc compression | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~6,589 | · | · | · | · | · | · | · | · | ~3,262 | · | · | · | · | · | · |
| · Summary content | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~2,106 | · |
| · Summary system | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~184 | · |
| Director context message ▸ | ~5,224 | ~5,206 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director task | ~2,557 | ~2,548 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director context | ~2,459 | ~2,450 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director current action | ~191 | ~190 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director constraints | ~16 | ~16 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Writer protocol | · | · | ~5,497 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Shared protocol ▸ | ~1,515 | ~1,510 | ~1,499 | ~61 | ~62 | ~62 | ~62 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Engine contract | ~183 | ~183 | ~181 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · VN background system | · | · | · | ~61 | ~62 | ~62 | ~62 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · Directive interpretation lock | ~59 | ~59 | ~59 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| VN background capsule ▸ | · | · | · | ~965 | ~993 | ~988 | ~982 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background brief | · | · | · | ~864 | ~889 | ~885 | ~879 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background input | · | · | · | ~41 | ~42 | ~42 | ~42 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background project | · | · | · | ~15 | ~16 | ~16 | ~16 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background knowledge | · | · | · | ~7 | ~7 | ~7 | ~7 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background simulation | · | · | · | ~7 | ~7 | ~7 | ~7 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background history | · | · | · | ~6 | ~6 | ~6 | ~6 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| · VN background canon | · | · | · | ~4 | ~4 | ~4 | ~4 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | ~— |
| Analysis response | ~2,118 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Writer directives | · | · | ~1,954 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Current action | · | · | ~110 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Writer task | · | · | ~42 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Bottom instruction | · | · | ~6 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Message formatting | ~8 | ~8 | ~15 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |

## 3. Full matrix — characters (provider-independent; same bytes across calls for shared pieces)

| Payload (depth = semantic nesting) | C1 Director (Ledger Asyn… | C2 Director (Analysis) | C3 Writer | C4 Plugin:relationship_t… | C5 Plugin:quest_tracker | C6 Plugin:personality_tr… | C7 Plugin:personality_tr… | C8 Plugin:world_state_tr… | C9 Plugin:world_location… | C10 Smart OST Select | C11 Plugin:post_writer_co… | C12 Plugin:post_writer_co… | C13 Plugin:post_writer_co… | C14 Plugin:post_writer_co… | C15 Plugin:post_writer_co… | C16 MemoryLOD Arc Compres… | C17 Plugin:vn_cinematogra… | C18 Plugin:vn_cinematogra… | C19 Reaction Director | C20 Select Best Background | C21 Conversation Staging … | C22 Gaze Director | C23 Emotion Classifier - … | C24 Plugin:post_writer_co… | C25 MemoryLOD Arc Compres… | C26 Plugin:post_writer_co… | C27 Smart OST Filters | C28 Emotion Classifier - … | C29 Synopsis Request | C30 Summary Request | C31 Plugin:story_arc_trac… |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shared history ▸ | 131,199 | 131,199 | 131,199 | 97,641 | 97,938 | 97,641 | 89,607 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 89,607 |
| · VN background scene | · | · | · | 8,034 | 8,331 | 8,034 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Plugin tasks ▸ | · | · | · | 63,138 | 37,249 | 4,592 | 4,875 | 56,825 | 42,552 | · | 33,232 | 32,826 | 32,948 | 32,919 | 32,322 | · | 17,332 | 17,807 | · | · | · | · | · | 12,357 | · | 11,459 | · | · | · | · | 9,430 |
| · Extraction Request | · | · | · | · | · | · | · | 56,825 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Relationship Change Extraction | · | · | · | 63,138 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Location Update | · | · | · | · | · | · | · | · | 42,552 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Story Objective Tracking | · | · | · | · | 37,249 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat3 Dialogue ▸ | · | · | · | · | · | · | · | · | · | · | 33,232 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | 33,232 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat3 Dialogue | · | · | · | · | · | · | · | · | · | · | 33,232 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat1 Banned Phrases ▸ | · | · | · | · | · | · | · | · | · | · | · | 32,826 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | 32,826 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat1 Banned Phrases | · | · | · | · | · | · | · | · | · | · | · | 32,826 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat2 Repetition ▸ | · | · | · | · | · | · | · | · | · | · | · | · | 32,948 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | 32,948 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat2 Repetition | · | · | · | · | · | · | · | · | · | · | · | · | 32,948 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat5 Prose ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | 32,919 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | 32,919 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat5 Prose | · | · | · | · | · | · | · | · | · | · | · | · | · | 32,919 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Flag Cat4 Familiarity ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 32,322 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 32,322 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Cat4 Familiarity | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 32,322 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Cinematography Cinematographer Maintrack ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 17,332 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Track ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 17,332 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 3 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 8,593 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 7,105 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 2 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1,634 | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Cinematography Cinematographer Cameratrack ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 17,807 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · Track ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 17,807 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 3 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 8,593 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 7,031 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · · · Message 2 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 2,183 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Hq Corrector ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 12,357 | · | · | · | · | · | · | · |
| · · Corrector ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 12,357 | · | · | · | · | · | · | · |
| · · · Review Target | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 10,106 | · | · | · | · | · | · | · |
| · · · Instructions | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 2,251 | · | · | · | · | · | · | · |
| · Hq Flag Consistency ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 11,459 | · | · | · | · | · |
| · · Flag ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 11,459 | · | · | · | · | · |
| · · · Consistency ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 11,459 | · | · | · | · | · |
| · · · · Review Target | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 8,975 | · | · | · | · | · |
| · · · · Instructions | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 2,484 | · | · | · | · | · |
| · Personality Ledger Consolidation | · | · | · | · | · | · | 4,875 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Personality Change Extraction | · | · | · | · | · | 4,592 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Story Arc Classification | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 9,430 |
| Shared canon ▸ | 39,981 | 39,981 | 39,981 | 39,915 | 39,915 | 39,915 | 39,915 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 39,915 |
| · Character canon ▸ | 39,855 | 39,855 | 39,855 | 39,855 | 39,855 | 39,855 | 39,855 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 39,855 |
| · · Sheets | 39,855 | 39,855 | 39,855 | 39,855 | 39,855 | 39,855 | 39,855 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 39,855 |
| · Static lore file | 60 | 60 | 60 | 60 | 60 | 60 | 60 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 60 |
| Core VN calls ▸ | · | · | · | · | · | · | · | · | · | 31,407 | · | · | · | · | · | · | · | · | 17,427 | 13,765 | 13,406 | 13,008 | 12,765 | · | · | · | 9,718 | 10,024 | 9,426 | · | · |
| · Core VN task | · | · | · | · | · | · | · | · | · | 30,881 | · | · | · | · | · | · | · | · | 16,901 | 13,239 | 4,558 | 4,160 | · | · | · | · | 9,192 | · | 866 | · | · |
| · Core VN scene | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 8,322 | 8,322 | · | · | · | · | · | · | 8,034 | · | · |
| · Emotion classification | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 12,765 | · | · | · | · | 10,024 | · | · | · |
| · Core VN scene capsule | · | · | · | · | · | · | · | · | · | 278 | · | · | · | · | · | · | · | · | 278 | 278 | 278 | 278 | · | · | · | · | 278 | · | 278 | · | · |
| · Core VN system | · | · | · | · | · | · | · | · | · | 248 | · | · | · | · | · | · | · | · | 248 | 248 | 248 | 248 | · | · | · | · | 248 | · | 248 | · | · |
| Shared dynamic knowledge ▸ | 18,200 | 18,200 | 18,200 | 18,129 | 18,129 | 18,129 | 18,129 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 18,129 |
| · Recalled memories ▸ | 10,211 | 10,211 | 10,211 | 10,211 | 10,211 | 10,211 | 10,211 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 10,211 |
| · · Memories | 10,211 | 10,211 | 10,211 | 10,211 | 10,211 | 10,211 | 10,211 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 10,211 |
| · Lore entries ▸ | 7,918 | 7,918 | 7,918 | 7,918 | 7,918 | 7,918 | 7,918 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 7,918 |
| · · Entries | 7,918 | 7,918 | 7,918 | 7,918 | 7,918 | 7,918 | 7,918 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 7,918 |
| Shared simulation ▸ | 10,453 | 10,453 | 10,453 | 10,377 | 10,377 | 10,377 | 10,377 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 10,377 |
| · World state context ▸ | 6,248 | 6,248 | 6,248 | 6,248 | 6,248 | 6,248 | 6,248 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 6,248 |
| · · Current State | 6,173 | 6,173 | 6,173 | 6,173 | 6,173 | 6,173 | 6,173 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 6,173 |
| · Location context ▸ | 4,129 | 4,129 | 4,129 | 4,129 | 4,129 | 4,129 | 4,129 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 4,129 |
| · · Current State | 4,051 | 4,051 | 4,051 | 4,051 | 4,051 | 4,051 | 4,051 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 4,051 |
| Director protocol ▸ | 34,184 | 27,396 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Analysis instructions | 27,396 | 27,396 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Ledger instructions | 6,788 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Core memory calls ▸ | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 29,639 | · | · | · | · | · | · | · | · | 15,018 | · | · | · | · | 8,602 | · |
| · Arc compression | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 29,639 | · | · | · | · | · | · | · | · | 15,018 | · | · | · | · | · | · |
| · Summary content | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 7,911 | · |
| · Summary system | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 691 | · |
| Director context message ▸ | 21,981 | 21,981 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director task | 10,758 | 10,758 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director context | 10,345 | 10,345 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director current action | 804 | 804 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · Director constraints | 68 | 68 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Writer protocol | · | · | 23,380 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Shared protocol ▸ | 6,376 | 6,376 | 6,376 | 269 | 269 | 269 | 269 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 269 |
| · Engine contract | 771 | 771 | 771 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| · VN background system | · | · | · | 269 | 269 | 269 | 269 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 269 |
| · Directive interpretation lock | 249 | 249 | 249 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| VN background capsule ▸ | · | · | · | 4,280 | 4,280 | 4,280 | 4,280 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 4,280 |
| · VN background brief | · | · | · | 3,832 | 3,832 | 3,832 | 3,832 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 3,832 |
| · VN background input | · | · | · | 183 | 183 | 183 | 183 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 183 |
| · VN background project | · | · | · | 68 | 68 | 68 | 68 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 68 |
| · VN background knowledge | · | · | · | 30 | 30 | 30 | 30 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 30 |
| · VN background simulation | · | · | · | 30 | 30 | 30 | 30 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 30 |
| · VN background history | · | · | · | 28 | 28 | 28 | 28 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 28 |
| · VN background canon | · | · | · | 18 | 18 | 18 | 18 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 18 |
| Analysis response | 8,914 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Writer directives | · | · | 8,313 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Current action | · | · | 468 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Writer task | · | · | 179 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Bottom instruction | · | · | 25 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| Message formatting | 35 | 35 | 63 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |

## 4. Per-call detail (fully expanded trees with leaf spans)

### Call 1: Director (Ledger Async)

- requestId: `core.director.followup` · callId: `llm_live_1790634034329_4` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 64,482 (cached 60,416) · output: 3,976 · reasoning: 2,874
- price: total $0.002528 = input $0.000569 + output $0.001113 (cache savings $0.007612)
- prompt hash: `2a3b0b78e3634f74`

- **Shared history** `root.history` — 131,199 chars · ~31,180 (48.4% of input)
- **Shared canon** `root.canon` — 39,981 chars · ~9,502 (14.7% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~9,472 (14.7% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~9,472 (14.7% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets — 39,855 chars · ~9,472 · spans=[msg0:6509-46364]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core — 60 chars · ~14 · spans=[msg0:6447-6507]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,200 chars · ~4,325 (6.7% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,427 (3.8% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,427 (3.8% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall — 10,211 chars · ~2,427 · spans=[msg0:46433-56644]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,882 (2.9% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,882 (2.9% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book — 7,918 chars · ~1,882 · spans=[msg0:56646-64564]
- **Shared simulation** `root.simulation` — 10,453 chars · ~2,484 (3.9% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,485 (2.3% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,467 (2.3% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker — 6,173 chars · ~1,467 · spans=[msg9:114-6287]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~981 (1.5% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~963 (1.5% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker — 4,051 chars · ~963 · spans=[msg9:6367-10418]
- **Director protocol** `director.protocol` — 34,184 chars · ~8,124 (12.6% of input)
  - **Analysis instructions** `core.director.analysis_instructions` — 27,396 chars · ~6,511 (10.1% of input)
    - piece `core.director.analysis_instructions` · owner=core — 27,396 chars · ~6,511 · spans=[msg11:0-27396]
  - **Ledger instructions** `core.director.ledger_instructions` — 6,788 chars · ~1,613 (2.5% of input)
    - piece `core.director.ledger_instructions` · owner=core — 6,788 chars · ~1,613 · spans=[msg13:0-6788]
- **Director context message** `core.director.context_message` — 21,981 chars · ~5,224 (8.1% of input)
  - **Director task** `core.director.task` — 10,758 chars · ~2,557 (4.0% of input)
    - piece `core.director.task` · owner=core — 10,758 chars · ~2,557 · spans=[msg10:0-10758]
  - **Director context** `core.director.context` — 10,345 chars · ~2,459 (3.8% of input)
    - piece `core.director.context` · owner=core — 10,345 chars · ~2,459 · spans=[msg10:10760-21105]
  - **Director current action** `core.director.current_action` — 804 chars · ~191 (0.3% of input)
    - piece `core.director.current_action` · owner=core — 804 chars · ~191 · spans=[msg10:21177-21981]
  - **Director constraints** `core.director.constraints` — 68 chars · ~16 (0.0% of input)
    - piece `core.director.constraints` · owner=core — 68 chars · ~16 · spans=[msg10:21107-21175]
- **Shared protocol** `root.protocol` — 6,376 chars · ~1,515 (2.3% of input)
  - **Engine contract** `core.shared.engine_contract` — 771 chars · ~183 (0.3% of input)
    - piece `core.shared.engine_contract` · owner=core — 771 chars · ~183 · spans=[msg0:0-771]
  - **Directive interpretation lock** `core.shared.interpretation_lock` — 249 chars · ~59 (0.1% of input)
    - piece `core.shared.interpretation_lock` · owner=core — 249 chars · ~59 · spans=[msg0:6141-6390]
- **Analysis response** `core.director.analysis_response` — 8,914 chars · ~2,118 (3.3% of input)
  - piece `core.director.analysis_response` · owner=core — 8,914 chars · ~2,118 · spans=[msg12:0-8914]
- **Message formatting** `__formatting__` — 35 chars · ~8 (0.0% of input)

### Call 2: Director (Analysis)

- requestId: `core.director.analysis` · callId: `llm_live_1790633994414_3` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 60,538 (cached 0) · output: 4,303 · reasoning: 2,090
- price: total $0.009680 = input $0.008475 + output $0.001205
- prompt hash: `a625850705605a02`

- **Shared history** `root.history` — 131,199 chars · ~31,071 (51.3% of input)
- **Shared canon** `root.canon` — 39,981 chars · ~9,469 (15.6% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~9,439 (15.6% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~9,439 (15.6% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets — 39,855 chars · ~9,439 · spans=[msg0:6509-46364]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core — 60 chars · ~14 · spans=[msg0:6447-6507]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,200 chars · ~4,310 (7.1% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,418 (4.0% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,418 (4.0% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall — 10,211 chars · ~2,418 · spans=[msg0:46433-56644]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,875 (3.1% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,875 (3.1% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book — 7,918 chars · ~1,875 · spans=[msg0:56646-64564]
- **Shared simulation** `root.simulation` — 10,453 chars · ~2,476 (4.1% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,480 (2.4% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,462 (2.4% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker — 6,173 chars · ~1,462 · spans=[msg9:114-6287]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~978 (1.6% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~959 (1.6% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker — 4,051 chars · ~959 · spans=[msg9:6367-10418]
- **Director protocol** `director.protocol` — 27,396 chars · ~6,488 (10.7% of input)
  - **Analysis instructions** `core.director.analysis_instructions` — 27,396 chars · ~6,488 (10.7% of input)
    - piece `core.director.analysis_instructions` · owner=core — 27,396 chars · ~6,488 · spans=[msg11:0-27396]
- **Director context message** `core.director.context_message` — 21,981 chars · ~5,206 (8.6% of input)
  - **Director task** `core.director.task` — 10,758 chars · ~2,548 (4.2% of input)
    - piece `core.director.task` · owner=core — 10,758 chars · ~2,548 · spans=[msg10:0-10758]
  - **Director context** `core.director.context` — 10,345 chars · ~2,450 (4.0% of input)
    - piece `core.director.context` · owner=core — 10,345 chars · ~2,450 · spans=[msg10:10760-21105]
  - **Director current action** `core.director.current_action` — 804 chars · ~190 (0.3% of input)
    - piece `core.director.current_action` · owner=core — 804 chars · ~190 · spans=[msg10:21177-21981]
  - **Director constraints** `core.director.constraints` — 68 chars · ~16 (0.0% of input)
    - piece `core.director.constraints` · owner=core — 68 chars · ~16 · spans=[msg10:21107-21175]
- **Shared protocol** `root.protocol` — 6,376 chars · ~1,510 (2.5% of input)
  - **Engine contract** `core.shared.engine_contract` — 771 chars · ~183 (0.3% of input)
    - piece `core.shared.engine_contract` · owner=core — 771 chars · ~183 · spans=[msg0:0-771]
  - **Directive interpretation lock** `core.shared.interpretation_lock` — 249 chars · ~59 (0.1% of input)
    - piece `core.shared.interpretation_lock` · owner=core — 249 chars · ~59 · spans=[msg0:6141-6390]
- **Message formatting** `__formatting__` — 35 chars · ~8 (0.0% of input)

### Call 3: Writer

- requestId: `core.writer` · callId: `llm_live_1790634034435_5` · status: **measured**
- model: `deepseek/deepseek-v4-pro-0813:thinking` · provider: `nano_gpt`
- provider input: 56,104 (cached 0) · output: 6,511 · reasoning: 3,335
- price: total $0.0780 = input $0.0617 + output $0.0163
- prompt hash: `5cd8b71a1820fb1b`

- **Shared history** `root.history` — 131,199 chars · ~30,845 (55.0% of input)
- **Shared canon** `root.canon` — 39,981 chars · ~9,400 (16.8% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~9,370 (16.7% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~9,370 (16.7% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets — 39,855 chars · ~9,370 · spans=[msg0:6509-46364]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core — 60 chars · ~14 · spans=[msg0:6447-6507]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,200 chars · ~4,279 (7.6% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,401 (4.3% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,401 (4.3% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall — 10,211 chars · ~2,401 · spans=[msg0:46433-56644]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,862 (3.3% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,862 (3.3% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book — 7,918 chars · ~1,862 · spans=[msg0:56646-64564]
- **Shared simulation** `root.simulation` — 10,453 chars · ~2,458 (4.4% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,469 (2.6% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,451 (2.6% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker — 6,173 chars · ~1,451 · spans=[msg9:114-6287]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~971 (1.7% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~952 (1.7% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker — 4,051 chars · ~952 · spans=[msg9:6367-10418]
- **Writer protocol** `writer.protocol` — 23,380 chars · ~5,497 (9.8% of input)
  - piece `writer.protocol` · owner=core — 23,314 chars · ~5,481 · spans=[msg10:8506-31820]
  - piece `writer.protocol` · owner=core — 66 chars · ~16 · spans=[msg11:0-66]
- **Shared protocol** `root.protocol` — 6,376 chars · ~1,499 (2.7% of input)
  - **Engine contract** `core.shared.engine_contract` — 771 chars · ~181 (0.3% of input)
    - piece `core.shared.engine_contract` · owner=core — 771 chars · ~181 · spans=[msg0:0-771]
  - **Directive interpretation lock** `core.shared.interpretation_lock` — 249 chars · ~59 (0.1% of input)
    - piece `core.shared.interpretation_lock` · owner=core — 249 chars · ~59 · spans=[msg0:6141-6390]
- **Writer directives** `writer.directives` — 8,313 chars · ~1,954 (3.5% of input)
  - piece `writer.directives` · owner=core — 8,313 chars · ~1,954 · spans=[msg10:186-8499]
- **Current action** `core.writer.current_action` — 468 chars · ~110 (0.2% of input)
  - piece `core.writer.current_action` · owner=core — 468 chars · ~110 · spans=[msg10:31827-32295]
- **Writer task** `core.writer.task` — 179 chars · ~42 (0.1% of input)
  - piece `core.writer.task` · owner=core — 179 chars · ~42 · spans=[msg10:0-179]
- **Bottom instruction** `core.writer.bottom_instruction` — 25 chars · ~6 (0.0% of input)
  - piece `core.writer.bottom_instruction` · owner=core — 25 chars · ~6 · spans=[msg10:32302-32327]
- **Message formatting** `__formatting__` — 63 chars · ~15 (0.0% of input)

### Call 4: Plugin:relationship_tracker

- requestId: `core.vn_background` · callId: `llm_live_1790634178948_30` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 52,695 (cached 39,168) · output: 1,598 · reasoning: 1,380
- price: total $0.002890 = input $0.001894 + output $0.000447 (cache savings $0.004935)
- prompt hash: `63163923551cb9b8`

- **Shared history** `root.history` — 97,641 chars · ~22,012 (41.8% of input)
  - **VN background scene** `core.vn_background.scene` — 8,034 chars · ~1,811 (3.4% of input)
    - piece `core.vn_background.scene` · owner=core — 8,034 chars · ~1,811 · spans=[msg2:0-8034]
- **Plugin tasks** `core.plugin_tasks` — 63,138 chars · ~14,233 (27.0% of input)
  - **Relationship Change Extraction** `relationship_tracker.relationship_change_extraction` — 63,138 chars · ~14,233 (27.0% of input)
    - piece `relationship_tracker.relationship_change_extraction` · owner=relationship_tracker — 63,138 chars · ~14,233 · spans=[msg3:0-63138]
- **Shared canon** `root.canon` — 39,915 chars · ~8,998 (17.1% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~8,985 (17.1% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~8,985 (17.1% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets · src=pcs-10c1d257-0935- — 39,855 chars · ~8,985 · spans=[msg1:4204-44059]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core · key=static-lore-lore-0-test4.md · src=pcs-407a6439-c0ba- — 60 chars · ~14 · spans=[msg1:4142-4202]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,129 chars · ~4,087 (7.8% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,302 (4.4% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,302 (4.4% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall · src=pcs-bdfdab9c-b22a- — 10,211 chars · ~2,302 · spans=[msg1:44089-54300]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,785 (3.4% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,785 (3.4% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book · src=pcs-deb8b181-7b89- — 7,918 chars · ~1,785 · spans=[msg1:54302-62220]
- **Shared simulation** `root.simulation` — 10,377 chars · ~2,339 (4.4% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,409 (2.7% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,392 (2.6% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker · src=pcs-e72072da-6026- — 6,173 chars · ~1,392 · spans=[msg1:62307-68480]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~931 (1.8% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~913 (1.7% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker · src=pcs-291016a4-0804- — 4,051 chars · ~913 · spans=[msg1:68560-72611]
- **Shared protocol** `root.protocol` — 269 chars · ~61 (0.1% of input)
  - **VN background system** `core.vn_background.system` — 269 chars · ~61 (0.1% of input)
    - piece `core.vn_background.system` · owner=core — 269 chars · ~61 · spans=[msg0:0-269]
- **VN background capsule** `core.vn_background.capsule` — 4,280 chars · ~965 (1.8% of input)
  - **VN background brief** `core.vn_background.capsule.brief` — 3,832 chars · ~864 (1.6% of input)
    - piece `core.vn_background.capsule.brief` · owner=core — 3,832 chars · ~864 · spans=[msg1:292-4124]
  - **VN background input** `core.vn_background.capsule.input` — 183 chars · ~41 (0.1% of input)
    - piece `core.vn_background.capsule.input` · owner=core — 183 chars · ~41 · spans=[msg1:107-290]
  - **VN background project** `core.vn_background.capsule.project` — 68 chars · ~15 (0.0% of input)
    - piece `core.vn_background.capsule.project` · owner=core — 68 chars · ~15 · spans=[msg1:37-105]
  - **VN background knowledge** `core.vn_background.capsule.knowledge` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.knowledge` · owner=core — 30 chars · ~7 · spans=[msg1:44061-44089 msg1:54300-54302]
  - **VN background simulation** `core.vn_background.capsule.simulation` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.simulation` · owner=core — 30 chars · ~7 · spans=[msg1:62222-62250 msg1:68498-68500]
  - **VN background history** `core.vn_background.capsule.history` — 28 chars · ~6 (0.0% of input)
    - piece `core.vn_background.capsule.history` · owner=core — 28 chars · ~6 · spans=[msg1:72631-72659]
  - **VN background canon** `core.vn_background.capsule.canon` — 18 chars · ~4 (0.0% of input)
    - piece `core.vn_background.capsule.canon` · owner=core — 18 chars · ~4 · spans=[msg1:4126-4142 msg1:4202-4204]

### Call 5: Plugin:quest_tracker

- requestId: `core.vn_background` · callId: `llm_live_1790634173934_28` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 48,284 (cached 37,120) · output: 1,783 · reasoning: 1,297
- price: total $0.002582 = input $0.001563 + output $0.000499 (cache savings $0.004677)
- prompt hash: `8f1ee4bff5d9f0a3`

- **Shared history** `root.history` — 97,938 chars · ~22,718 (47.1% of input)
  - **VN background scene** `core.vn_background.scene` — 8,331 chars · ~1,932 (4.0% of input)
    - piece `core.vn_background.scene` · owner=core — 8,331 chars · ~1,932 · spans=[msg2:0-8331]
- **Plugin tasks** `core.plugin_tasks` — 37,249 chars · ~8,640 (17.9% of input)
  - **Story Objective Tracking** `quest_tracker.story_objective_tracking` — 37,249 chars · ~8,640 (17.9% of input)
    - piece `quest_tracker.story_objective_tracking` · owner=quest_tracker — 37,249 chars · ~8,640 · spans=[msg3:0-37249]
- **Shared canon** `root.canon` — 39,915 chars · ~9,259 (19.2% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~9,245 (19.1% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~9,245 (19.1% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets · src=pcs-10c1d257-0935- — 39,855 chars · ~9,245 · spans=[msg1:4204-44059]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core · key=static-lore-lore-0-test4.md · src=pcs-407a6439-c0ba- — 60 chars · ~14 · spans=[msg1:4142-4202]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,129 chars · ~4,205 (8.7% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,369 (4.9% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,369 (4.9% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall · src=pcs-bdfdab9c-b22a- — 10,211 chars · ~2,369 · spans=[msg1:44089-54300]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,837 (3.8% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,837 (3.8% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book · src=pcs-deb8b181-7b89- — 7,918 chars · ~1,837 · spans=[msg1:54302-62220]
- **Shared simulation** `root.simulation` — 10,377 chars · ~2,407 (5.0% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,449 (3.0% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,432 (3.0% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker · src=pcs-e72072da-6026- — 6,173 chars · ~1,432 · spans=[msg1:62307-68480]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~958 (2.0% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~940 (1.9% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker · src=pcs-291016a4-0804- — 4,051 chars · ~940 · spans=[msg1:68560-72611]
- **Shared protocol** `root.protocol` — 269 chars · ~62 (0.1% of input)
  - **VN background system** `core.vn_background.system` — 269 chars · ~62 (0.1% of input)
    - piece `core.vn_background.system` · owner=core — 269 chars · ~62 · spans=[msg0:0-269]
- **VN background capsule** `core.vn_background.capsule` — 4,280 chars · ~993 (2.1% of input)
  - **VN background brief** `core.vn_background.capsule.brief` — 3,832 chars · ~889 (1.8% of input)
    - piece `core.vn_background.capsule.brief` · owner=core — 3,832 chars · ~889 · spans=[msg1:292-4124]
  - **VN background input** `core.vn_background.capsule.input` — 183 chars · ~42 (0.1% of input)
    - piece `core.vn_background.capsule.input` · owner=core — 183 chars · ~42 · spans=[msg1:107-290]
  - **VN background project** `core.vn_background.capsule.project` — 68 chars · ~16 (0.0% of input)
    - piece `core.vn_background.capsule.project` · owner=core — 68 chars · ~16 · spans=[msg1:37-105]
  - **VN background knowledge** `core.vn_background.capsule.knowledge` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.knowledge` · owner=core — 30 chars · ~7 · spans=[msg1:44061-44089 msg1:54300-54302]
  - **VN background simulation** `core.vn_background.capsule.simulation` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.simulation` · owner=core — 30 chars · ~7 · spans=[msg1:62222-62250 msg1:68498-68500]
  - **VN background history** `core.vn_background.capsule.history` — 28 chars · ~6 (0.0% of input)
    - piece `core.vn_background.capsule.history` · owner=core — 28 chars · ~6 · spans=[msg1:72631-72659]
  - **VN background canon** `core.vn_background.capsule.canon` — 18 chars · ~4 (0.0% of input)
    - piece `core.vn_background.capsule.canon` · owner=core — 18 chars · ~4 · spans=[msg1:4126-4142 msg1:4202-4204]

### Call 6: Plugin:personality_tracker (Batch)

- requestId: `core.vn_background` · callId: `llm_live_1790634168928_25` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 40,458 (cached 0) · output: 757 · reasoning: 741
- price: total $0.005876 = input $0.005664 + output $0.000212
- prompt hash: `b0d6f621b01c23b5`

- **Shared history** `root.history` — 97,641 chars · ~22,547 (55.7% of input)
  - **VN background scene** `core.vn_background.scene` — 8,034 chars · ~1,855 (4.6% of input)
    - piece `core.vn_background.scene` · owner=core — 8,034 chars · ~1,855 · spans=[msg2:0-8034]
- **Plugin tasks** `core.plugin_tasks` — 4,592 chars · ~1,060 (2.6% of input)
  - **Personality Change Extraction** `personality_tracker.personality_change_extraction` — 4,592 chars · ~1,060 (2.6% of input)
    - piece `personality_tracker.personality_change_extraction` · owner=personality_tracker — 4,592 chars · ~1,060 · spans=[msg3:0-4592]
- **Shared canon** `root.canon` — 39,915 chars · ~9,217 (22.8% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~9,203 (22.7% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~9,203 (22.7% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets · src=pcs-10c1d257-0935- — 39,855 chars · ~9,203 · spans=[msg1:4204-44059]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core · key=static-lore-lore-0-test4.md · src=pcs-407a6439-c0ba- — 60 chars · ~14 · spans=[msg1:4142-4202]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,129 chars · ~4,186 (10.3% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,358 (5.8% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,358 (5.8% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall · src=pcs-bdfdab9c-b22a- — 10,211 chars · ~2,358 · spans=[msg1:44089-54300]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,828 (4.5% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,828 (4.5% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book · src=pcs-deb8b181-7b89- — 7,918 chars · ~1,828 · spans=[msg1:54302-62220]
- **Shared simulation** `root.simulation` — 10,377 chars · ~2,396 (5.9% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,443 (3.6% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,425 (3.5% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker · src=pcs-e72072da-6026- — 6,173 chars · ~1,425 · spans=[msg1:62307-68480]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~953 (2.4% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~935 (2.3% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker · src=pcs-291016a4-0804- — 4,051 chars · ~935 · spans=[msg1:68560-72611]
- **Shared protocol** `root.protocol` — 269 chars · ~62 (0.2% of input)
  - **VN background system** `core.vn_background.system` — 269 chars · ~62 (0.2% of input)
    - piece `core.vn_background.system` · owner=core — 269 chars · ~62 · spans=[msg0:0-269]
- **VN background capsule** `core.vn_background.capsule` — 4,280 chars · ~988 (2.4% of input)
  - **VN background brief** `core.vn_background.capsule.brief` — 3,832 chars · ~885 (2.2% of input)
    - piece `core.vn_background.capsule.brief` · owner=core — 3,832 chars · ~885 · spans=[msg1:292-4124]
  - **VN background input** `core.vn_background.capsule.input` — 183 chars · ~42 (0.1% of input)
    - piece `core.vn_background.capsule.input` · owner=core — 183 chars · ~42 · spans=[msg1:107-290]
  - **VN background project** `core.vn_background.capsule.project` — 68 chars · ~16 (0.0% of input)
    - piece `core.vn_background.capsule.project` · owner=core — 68 chars · ~16 · spans=[msg1:37-105]
  - **VN background knowledge** `core.vn_background.capsule.knowledge` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.knowledge` · owner=core — 30 chars · ~7 · spans=[msg1:44061-44089 msg1:54300-54302]
  - **VN background simulation** `core.vn_background.capsule.simulation` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.simulation` · owner=core — 30 chars · ~7 · spans=[msg1:62222-62250 msg1:68498-68500]
  - **VN background history** `core.vn_background.capsule.history` — 28 chars · ~6 (0.0% of input)
    - piece `core.vn_background.capsule.history` · owner=core — 28 chars · ~6 · spans=[msg1:72631-72659]
  - **VN background canon** `core.vn_background.capsule.canon` — 18 chars · ~4 (0.0% of input)
    - piece `core.vn_background.capsule.canon` · owner=core — 18 chars · ~4 · spans=[msg1:4126-4142 msg1:4202-4204]

### Call 7: Plugin:personality_tracker

- requestId: `core.vn_background` · callId: `llm_live_1790634186272_31` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 38,410 (cached 37,120) · output: 1,477 · reasoning: 1,098
- price: total $0.001114 = input $0.000181 + output $0.000414 (cache savings $0.004677)
- prompt hash: `195b690c59436fc1`

- **Shared history** `root.history` — 89,607 chars · ~20,554 (53.5% of input)
- **Plugin tasks** `core.plugin_tasks` — 4,875 chars · ~1,118 (2.9% of input)
  - **Personality Ledger Consolidation** `personality_tracker.personality_ledger_consolidation` — 4,875 chars · ~1,118 (2.9% of input)
    - piece `personality_tracker.personality_ledger_consolidation` · owner=personality_tracker — 4,875 chars · ~1,118 · spans=[msg2:0-4875]
- **Shared canon** `root.canon` — 39,915 chars · ~9,156 (23.8% of input)
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~9,142 (23.8% of input)
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~9,142 (23.8% of input)
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets · src=pcs-10c1d257-0935- — 39,855 chars · ~9,142 · spans=[msg1:4204-44059]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~14 (0.0% of input)
    - piece `core.canon.static_lore_file` · owner=core · key=static-lore-lore-0-test4.md · src=pcs-407a6439-c0ba- — 60 chars · ~14 · spans=[msg1:4142-4202]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,129 chars · ~4,158 (10.8% of input)
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~2,342 (6.1% of input)
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~2,342 (6.1% of input)
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall · src=pcs-bdfdab9c-b22a- — 10,211 chars · ~2,342 · spans=[msg1:44089-54300]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~1,816 (4.7% of input)
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~1,816 (4.7% of input)
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book · src=pcs-deb8b181-7b89- — 7,918 chars · ~1,816 · spans=[msg1:54302-62220]
- **Shared simulation** `root.simulation` — 10,377 chars · ~2,380 (6.2% of input)
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~1,433 (3.7% of input)
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~1,416 (3.7% of input)
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker · src=pcs-e72072da-6026- — 6,173 chars · ~1,416 · spans=[msg1:62307-68480]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~947 (2.5% of input)
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~929 (2.4% of input)
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker · src=pcs-291016a4-0804- — 4,051 chars · ~929 · spans=[msg1:68560-72611]
- **Shared protocol** `root.protocol` — 269 chars · ~62 (0.2% of input)
  - **VN background system** `core.vn_background.system` — 269 chars · ~62 (0.2% of input)
    - piece `core.vn_background.system` · owner=core — 269 chars · ~62 · spans=[msg0:0-269]
- **VN background capsule** `core.vn_background.capsule` — 4,280 chars · ~982 (2.6% of input)
  - **VN background brief** `core.vn_background.capsule.brief` — 3,832 chars · ~879 (2.3% of input)
    - piece `core.vn_background.capsule.brief` · owner=core — 3,832 chars · ~879 · spans=[msg1:292-4124]
  - **VN background input** `core.vn_background.capsule.input` — 183 chars · ~42 (0.1% of input)
    - piece `core.vn_background.capsule.input` · owner=core — 183 chars · ~42 · spans=[msg1:107-290]
  - **VN background project** `core.vn_background.capsule.project` — 68 chars · ~16 (0.0% of input)
    - piece `core.vn_background.capsule.project` · owner=core — 68 chars · ~16 · spans=[msg1:37-105]
  - **VN background knowledge** `core.vn_background.capsule.knowledge` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.knowledge` · owner=core — 30 chars · ~7 · spans=[msg1:44061-44089 msg1:54300-54302]
  - **VN background simulation** `core.vn_background.capsule.simulation` — 30 chars · ~7 (0.0% of input)
    - piece `core.vn_background.capsule.simulation` · owner=core — 30 chars · ~7 · spans=[msg1:62222-62250 msg1:68498-68500]
  - **VN background history** `core.vn_background.capsule.history` — 28 chars · ~6 (0.0% of input)
    - piece `core.vn_background.capsule.history` · owner=core — 28 chars · ~6 · spans=[msg1:72631-72659]
  - **VN background canon** `core.vn_background.capsule.canon` — 18 chars · ~4 (0.0% of input)
    - piece `core.vn_background.capsule.canon` · owner=core — 18 chars · ~4 · spans=[msg1:4126-4142 msg1:4202-4204]

### Call 8: Plugin:world_state_tracker

- requestId: `world_state_tracker.extraction_request` · callId: `llm_live_1790634108769_20` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 15,041 (cached 0) · output: 1,747 · reasoning: 1,112
- price: total $0.002595 = input $0.002106 + output $0.000489
- prompt hash: `01fd9e29ce93a7f7`

- **Plugin tasks** `core.plugin_tasks` — 56,825 chars · ~15,041 (100.0% of input)
  - **Extraction Request** `world_state_tracker.extraction_request` — 56,825 chars · ~15,041 (100.0% of input)
    - piece `world_state_tracker.extraction_request` · owner=world_state_tracker — 56,825 chars · ~15,041 · spans=[msg0:0-56825]

### Call 9: Plugin:world_location_tracker

- requestId: `world_location_tracker.location_update` · callId: `llm_live_1790634108059_18` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 11,043 (cached 0) · output: 993 · reasoning: 367
- price: total $0.001824 = input $0.001546 + output $0.000278
- prompt hash: `5824dda869c46a8f`

- **Plugin tasks** `core.plugin_tasks` — 42,552 chars · ~11,043 (100.0% of input)
  - **Location Update** `world_location_tracker.location_update` — 42,552 chars · ~11,043 (100.0% of input)
    - piece `world_location_tracker.location_update` · owner=world_location_tracker — 42,552 chars · ~11,043 · spans=[msg0:0-42552]

### Call 10: Smart OST Select

- requestId: `core.asset_selector.ost.smart_select` · callId: `llm_live_1790634116479_22` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 10,590 (cached 0) · output: 875 · reasoning: 0
- price: total $0.001040 = input $0.000847 + output $0.000193
- prompt hash: `6a0e34b6483f1b20`

- **Core VN calls** `core.vn` — 31,407 chars · ~10,590 (100.0% of input)
  - **Core VN task** `core.vn.task` — 30,881 chars · ~10,413 (98.3% of input)
    - piece `core.vn.task` · owner=core — 30,881 chars · ~10,413 · spans=[msg2:0-30881]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~94 (0.9% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~94 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~84 (0.8% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~84 · spans=[msg0:0-248]

### Call 11: Plugin:post_writer_consistency_checker:HQ:cat3_dialogue

- requestId: `post_writer_consistency_checker.hq_flag_cat3_dialogue` · callId: `llm_live_1790634101069_13` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 7,366 (cached 0) · output: 898 · reasoning: 896
- price: total $0.001283 = input $0.001031 + output $0.000251
- prompt hash: `17b3cb5598f16272`

- **Plugin tasks** `core.plugin_tasks` — 33,232 chars · ~7,366 (100.0% of input)
  - **Hq Flag Cat3 Dialogue** `post_writer_consistency_checker.hq_flag_cat3_dialogue` — 33,232 chars · ~7,366 (100.0% of input)
    - **Flag** `post_writer_consistency_checker.hq_flag_cat3_dialogue.flag` — 33,232 chars · ~7,366 (100.0% of input)
      - **Cat3 Dialogue** `post_writer_consistency_checker.hq_flag_cat3_dialogue.flag.cat3_dialogue` — 33,232 chars · ~7,366 (100.0% of input)
        - piece `post_writer_consistency_checker.hq_flag_cat3_dialogue.flag.cat3_dialogue` · owner=post_writer_consistency_checker — 33,232 chars · ~7,366 · spans=[msg0:0-33232]

### Call 12: Plugin:post_writer_consistency_checker:HQ:cat1_banned_phrases

- requestId: `post_writer_consistency_checker.hq_flag_cat1_banned_phrases` · callId: `llm_live_1790634101068_11` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 7,268 (cached 0) · output: 323 · reasoning: 321
- price: total $0.001108 = input $0.001018 + output $0.00009044
- prompt hash: `325a1dc16b57b4d7`

- **Plugin tasks** `core.plugin_tasks` — 32,826 chars · ~7,268 (100.0% of input)
  - **Hq Flag Cat1 Banned Phrases** `post_writer_consistency_checker.hq_flag_cat1_banned_phrases` — 32,826 chars · ~7,268 (100.0% of input)
    - **Flag** `post_writer_consistency_checker.hq_flag_cat1_banned_phrases.flag` — 32,826 chars · ~7,268 (100.0% of input)
      - **Cat1 Banned Phrases** `post_writer_consistency_checker.hq_flag_cat1_banned_phrases.flag.cat1_banned_phrases` — 32,826 chars · ~7,268 (100.0% of input)
        - piece `post_writer_consistency_checker.hq_flag_cat1_banned_phrases.flag.cat1_banned_phrases` · owner=post_writer_consistency_checker — 32,826 chars · ~7,268 · spans=[msg0:0-32826]

### Call 13: Plugin:post_writer_consistency_checker:HQ:cat2_repetition

- requestId: `post_writer_consistency_checker.hq_flag_cat2_repetition` · callId: `llm_live_1790634101069_12` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 7,248 (cached 0) · output: 1,433 · reasoning: 1,259
- price: total $0.001416 = input $0.001015 + output $0.000401
- prompt hash: `d1282e74fa3e67c2`

- **Plugin tasks** `core.plugin_tasks` — 32,948 chars · ~7,248 (100.0% of input)
  - **Hq Flag Cat2 Repetition** `post_writer_consistency_checker.hq_flag_cat2_repetition` — 32,948 chars · ~7,248 (100.0% of input)
    - **Flag** `post_writer_consistency_checker.hq_flag_cat2_repetition.flag` — 32,948 chars · ~7,248 (100.0% of input)
      - **Cat2 Repetition** `post_writer_consistency_checker.hq_flag_cat2_repetition.flag.cat2_repetition` — 32,948 chars · ~7,248 (100.0% of input)
        - piece `post_writer_consistency_checker.hq_flag_cat2_repetition.flag.cat2_repetition` · owner=post_writer_consistency_checker — 32,948 chars · ~7,248 · spans=[msg0:0-32948]

### Call 14: Plugin:post_writer_consistency_checker:HQ:cat5_prose

- requestId: `post_writer_consistency_checker.hq_flag_cat5_prose` · callId: `llm_live_1790634101072_15` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 7,242 (cached 0) · output: 890 · reasoning: 888
- price: total $0.001263 = input $0.001014 + output $0.000249
- prompt hash: `7b51cd5e38d5d768`

- **Plugin tasks** `core.plugin_tasks` — 32,919 chars · ~7,242 (100.0% of input)
  - **Hq Flag Cat5 Prose** `post_writer_consistency_checker.hq_flag_cat5_prose` — 32,919 chars · ~7,242 (100.0% of input)
    - **Flag** `post_writer_consistency_checker.hq_flag_cat5_prose.flag` — 32,919 chars · ~7,242 (100.0% of input)
      - **Cat5 Prose** `post_writer_consistency_checker.hq_flag_cat5_prose.flag.cat5_prose` — 32,919 chars · ~7,242 (100.0% of input)
        - piece `post_writer_consistency_checker.hq_flag_cat5_prose.flag.cat5_prose` · owner=post_writer_consistency_checker — 32,919 chars · ~7,242 · spans=[msg0:0-32919]

### Call 15: Plugin:post_writer_consistency_checker:HQ:cat4_familiarity

- requestId: `post_writer_consistency_checker.hq_flag_cat4_familiarity` · callId: `llm_live_1790634101071_14` · status: **measured**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: 7,117 (cached 0) · output: 659 · reasoning: 657
- price: total $0.001181 = input $0.000996 + output $0.000185
- prompt hash: `200dcfa6d4c2e952`

- **Plugin tasks** `core.plugin_tasks` — 32,322 chars · ~7,117 (100.0% of input)
  - **Hq Flag Cat4 Familiarity** `post_writer_consistency_checker.hq_flag_cat4_familiarity` — 32,322 chars · ~7,117 (100.0% of input)
    - **Flag** `post_writer_consistency_checker.hq_flag_cat4_familiarity.flag` — 32,322 chars · ~7,117 (100.0% of input)
      - **Cat4 Familiarity** `post_writer_consistency_checker.hq_flag_cat4_familiarity.flag.cat4_familiarity` — 32,322 chars · ~7,117 (100.0% of input)
        - piece `post_writer_consistency_checker.hq_flag_cat4_familiarity.flag.cat4_familiarity` · owner=post_writer_consistency_checker — 32,322 chars · ~7,117 · spans=[msg0:0-32322]

### Call 16: MemoryLOD Arc Compression

- requestId: `core.memory.arc_compression` · callId: `llm_live_1790633988916_1` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 6,589 (cached 0) · output: 1,632 · reasoning: 0
- price: total $0.000886 = input $0.000527 + output $0.000359
- prompt hash: `8f829f9b5543dade`

- **Core memory calls** `core.memory` — 29,639 chars · ~6,589 (100.0% of input)
  - **Arc compression** `core.memory.arc_compression` — 29,639 chars · ~6,589 (100.0% of input)
    - piece `core.memory.arc_compression` · owner=core — 29,639 chars · ~6,589 · spans=[msg0:0-29639]

### Call 17: Plugin:vn_cinematographer

- requestId: `vn_cinematographer.cinematography_cinematographer_maintrack` · callId: `llm_live_1790634169152_27` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 4,867 (cached 0) · output: 4,661 · reasoning: 0
- price: total $0.001415 = input $0.000389 + output $0.001025
- prompt hash: `dfcb5a9cd18e6167`

- **Plugin tasks** `core.plugin_tasks` — 17,332 chars · ~4,867 (100.0% of input)
  - **Cinematography Cinematographer Maintrack** `vn_cinematographer.cinematography_cinematographer_maintrack` — 17,332 chars · ~4,867 (100.0% of input)
    - **Track** `vn_cinematographer.cinematography_cinematographer_maintrack.track` — 17,332 chars · ~4,867 (100.0% of input)
      - **Message 3** `vn_cinematographer.cinematography_cinematographer_maintrack.track.message_3` — 8,593 chars · ~2,413 (49.6% of input)
        - piece `vn_cinematographer.cinematography_cinematographer_maintrack.track.message_3` · owner=vn_cinematographer — 8,593 chars · ~2,413 · spans=[msg2:0-8593]
      - **Message 1** `vn_cinematographer.cinematography_cinematographer_maintrack.track.message_1` — 7,105 chars · ~1,995 (41.0% of input)
        - piece `vn_cinematographer.cinematography_cinematographer_maintrack.track.message_1` · owner=vn_cinematographer — 7,105 chars · ~1,995 · spans=[msg0:0-7105]
      - **Message 2** `vn_cinematographer.cinematography_cinematographer_maintrack.track.message_2` — 1,634 chars · ~459 (9.4% of input)
        - piece `vn_cinematographer.cinematography_cinematographer_maintrack.track.message_2` · owner=vn_cinematographer — 1,634 chars · ~459 · spans=[msg1:0-1634]

### Call 18: Plugin:vn_cinematographer

- requestId: `vn_cinematographer.cinematography_cinematographer_cameratrack` · callId: `llm_live_1790634169150_26` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 4,787 (cached 0) · output: 5,345 · reasoning: 0
- price: total $0.001559 = input $0.000383 + output $0.001176
- prompt hash: `e995d3babee19a41`

- **Plugin tasks** `core.plugin_tasks` — 17,807 chars · ~4,787 (100.0% of input)
  - **Cinematography Cinematographer Cameratrack** `vn_cinematographer.cinematography_cinematographer_cameratrack` — 17,807 chars · ~4,787 (100.0% of input)
    - **Track** `vn_cinematographer.cinematography_cinematographer_cameratrack.track` — 17,807 chars · ~4,787 (100.0% of input)
      - **Message 3** `vn_cinematographer.cinematography_cinematographer_cameratrack.track.message_3` — 8,593 chars · ~2,310 (48.3% of input)
        - piece `vn_cinematographer.cinematography_cinematographer_cameratrack.track.message_3` · owner=vn_cinematographer — 8,593 chars · ~2,310 · spans=[msg2:0-8593]
      - **Message 1** `vn_cinematographer.cinematography_cinematographer_cameratrack.track.message_1` — 7,031 chars · ~1,890 (39.5% of input)
        - piece `vn_cinematographer.cinematography_cinematographer_cameratrack.track.message_1` · owner=vn_cinematographer — 7,031 chars · ~1,890 · spans=[msg0:0-7031]
      - **Message 2** `vn_cinematographer.cinematography_cinematographer_cameratrack.track.message_2` — 2,183 chars · ~587 (12.3% of input)
        - piece `vn_cinematographer.cinematography_cinematographer_cameratrack.track.message_2` · owner=vn_cinematographer — 2,183 chars · ~587 · spans=[msg1:0-2183]

### Call 19: Reaction Director

- requestId: `core.vn_analysis.reaction_director` · callId: `llm_live_1790634114283_21` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 4,494 (cached 128) · output: 6,382 · reasoning: 0
- price: total $0.001764 = input $0.000349 + output $0.001404
- prompt hash: `5b01595814b2ecd0`

- **Core VN calls** `core.vn` — 17,427 chars · ~4,494 (100.0% of input)
  - **Core VN task** `core.vn.task` — 16,901 chars · ~4,358 (97.0% of input)
    - piece `core.vn.task` · owner=core — 16,901 chars · ~4,358 · spans=[msg2:0-16901]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~72 (1.6% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~72 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~64 (1.4% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~64 · spans=[msg0:0-248]

### Call 20: Select Best Background

- requestId: `core.asset_selector.background.basic` · callId: `llm_live_1790634105848_17` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 3,762 (cached 0) · output: 222 · reasoning: 0
- price: total $0.000350 = input $0.000301 + output $0.00004884
- prompt hash: `40dc7a1eb8caa4f3`

- **Core VN calls** `core.vn` — 13,765 chars · ~3,762 (100.0% of input)
  - **Core VN task** `core.vn.task` — 13,239 chars · ~3,618 (96.2% of input)
    - piece `core.vn.task` · owner=core — 13,239 chars · ~3,618 · spans=[msg2:0-13239]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~76 (2.0% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~76 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~68 (1.8% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~68 · spans=[msg0:0-248]

### Call 21: Conversation Staging Classifier

- requestId: `core.vn_analysis.conversation_staging` · callId: `llm_live_1790634100794_7` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 3,568 (cached 0) · output: 13,225 · reasoning: 0
- price: total $0.003195 = input $0.000285 + output $0.002910
- prompt hash: `fc2074ffb1b5631f`

- **Core VN calls** `core.vn` — 13,406 chars · ~3,568 (100.0% of input)
  - **Core VN task** `core.vn.task` — 4,558 chars · ~1,213 (34.0% of input)
    - piece `core.vn.task` · owner=core — 4,558 chars · ~1,213 · spans=[msg3:0-4558]
  - **Core VN scene** `core.vn.scene` — 8,322 chars · ~2,215 (62.1% of input)
    - piece `core.vn.scene` · owner=core — 8,322 chars · ~2,215 · spans=[msg2:0-8322]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~74 (2.1% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~74 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~66 (1.8% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~66 · spans=[msg0:0-248]

### Call 22: Gaze Director

- requestId: `core.vn_analysis.gaze_director` · callId: `llm_live_1790634105790_16` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 3,530 (cached 0) · output: 3,535 · reasoning: 0
- price: total $0.001060 = input $0.000282 + output $0.000778
- prompt hash: `bc872cca120eac7d`

- **Core VN calls** `core.vn` — 13,008 chars · ~3,530 (100.0% of input)
  - **Core VN task** `core.vn.task` — 4,160 chars · ~1,129 (32.0% of input)
    - piece `core.vn.task` · owner=core — 4,160 chars · ~1,129 · spans=[msg3:0-4160]
  - **Core VN scene** `core.vn.scene` — 8,322 chars · ~2,258 (64.0% of input)
    - piece `core.vn.scene` · owner=core — 8,322 chars · ~2,258 · spans=[msg2:0-8322]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~75 (2.1% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~75 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~67 (1.9% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~67 · spans=[msg0:0-248]

### Call 23: Emotion Classifier - Chunk

- requestId: `core.vn.emotion_chunk` · callId: `llm_live_1790634100799_8` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 3,488 (cached 0) · output: 3,767 · reasoning: 0
- price: total $0.001108 = input $0.000279 + output $0.000829
- prompt hash: `2141c3f8d130c15e`

- **Core VN calls** `core.vn` — 12,765 chars · ~3,488 (100.0% of input)
  - **Emotion classification** `core.vn.emotion_classification` — 12,765 chars · ~3,488 (100.0% of input)
    - piece `core.vn.emotion_classification` · owner=core · key=chunk-0 — 12,765 chars · ~3,488 · spans=[msg0:0-12765]

### Call 24: Plugin:post_writer_consistency_checker:HQ:corrector

- requestId: `post_writer_consistency_checker.hq_corrector` · callId: `llm_live_1790634152747_23` · status: **measured**
- model: `deepseek/deepseek-v4-pro-0813:thinking` · provider: `nano_gpt`
- provider input: 3,286 (cached 0) · output: 1,696 · reasoning: 1,654
- price: total $0.007855 = input $0.003615 + output $0.004240
- prompt hash: `df2336370dc9cd44`

- **Plugin tasks** `core.plugin_tasks` — 12,357 chars · ~3,286 (100.0% of input)
  - **Hq Corrector** `post_writer_consistency_checker.hq_corrector` — 12,357 chars · ~3,286 (100.0% of input)
    - **Corrector** `post_writer_consistency_checker.hq_corrector.corrector` — 12,357 chars · ~3,286 (100.0% of input)
      - **Review Target** `post_writer_consistency_checker.hq_corrector.corrector.review_target` — 10,106 chars · ~2,687 (81.8% of input)
        - piece `post_writer_consistency_checker.hq_corrector.corrector.review_target` · owner=post_writer_consistency_checker — 10,106 chars · ~2,687 · spans=[msg1:0-10106]
      - **Instructions** `post_writer_consistency_checker.hq_corrector.corrector.instructions` — 2,251 chars · ~599 (18.2% of input)
        - piece `post_writer_consistency_checker.hq_corrector.corrector.instructions` · owner=post_writer_consistency_checker — 2,251 chars · ~599 · spans=[msg0:0-2251]

### Call 25: MemoryLOD Arc Compression

- requestId: `core.memory.arc_compression` · callId: `llm_live_1790633988924_2` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 3,262 (cached 0) · output: 581 · reasoning: 0
- price: total $0.000389 = input $0.000261 + output $0.000128
- prompt hash: `2d6a5e65fbbeae2e`

- **Core memory calls** `core.memory` — 15,018 chars · ~3,262 (100.0% of input)
  - **Arc compression** `core.memory.arc_compression` — 15,018 chars · ~3,262 (100.0% of input)
    - piece `core.memory.arc_compression` · owner=core — 15,018 chars · ~3,262 · spans=[msg0:0-15018]

### Call 26: Plugin:post_writer_consistency_checker:HQ:consistency

- requestId: `post_writer_consistency_checker.hq_flag_consistency` · callId: `llm_live_1790634101067_10` · status: **measured**
- model: `deepseek/deepseek-v4-pro-0813:thinking` · provider: `nano_gpt`
- provider input: 3,116 (cached 0) · output: 7,044 · reasoning: 7,042
- price: total $0.0210 = input $0.003428 + output $0.0176
- prompt hash: `ed61624359a2157d`

- **Plugin tasks** `core.plugin_tasks` — 11,459 chars · ~3,116 (100.0% of input)
  - **Hq Flag Consistency** `post_writer_consistency_checker.hq_flag_consistency` — 11,459 chars · ~3,116 (100.0% of input)
    - **Flag** `post_writer_consistency_checker.hq_flag_consistency.flag` — 11,459 chars · ~3,116 (100.0% of input)
      - **Consistency** `post_writer_consistency_checker.hq_flag_consistency.flag.consistency` — 11,459 chars · ~3,116 (100.0% of input)
        - **Review Target** `post_writer_consistency_checker.hq_flag_consistency.flag.consistency.review_target` — 8,975 chars · ~2,441 (78.3% of input)
          - piece `post_writer_consistency_checker.hq_flag_consistency.flag.consistency.review_target` · owner=post_writer_consistency_checker — 8,975 chars · ~2,441 · spans=[msg1:0-8975]
        - **Instructions** `post_writer_consistency_checker.hq_flag_consistency.flag.consistency.instructions` — 2,484 chars · ~675 (21.7% of input)
          - piece `post_writer_consistency_checker.hq_flag_consistency.flag.consistency.instructions` · owner=post_writer_consistency_checker — 2,484 chars · ~675 · spans=[msg0:0-2484]

### Call 27: Smart OST Filters

- requestId: `core.asset_selector.ost.smart_filters` · callId: `llm_live_1790634108536_19` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 2,745 (cached 0) · output: 2,693 · reasoning: 0
- price: total $0.000812 = input $0.000220 + output $0.000592
- prompt hash: `ada6e887d7abb286`

- **Core VN calls** `core.vn` — 9,718 chars · ~2,745 (100.0% of input)
  - **Core VN task** `core.vn.task` — 9,192 chars · ~2,596 (94.6% of input)
    - piece `core.vn.task` · owner=core — 9,192 chars · ~2,596 · spans=[msg2:0-9192]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~79 (2.9% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~79 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~70 (2.6% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~70 · spans=[msg0:0-248]

### Call 28: Emotion Classifier - Chunk

- requestId: `core.vn.emotion_chunk` · callId: `llm_live_1790634100801_9` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 2,728 (cached 0) · output: 5,289 · reasoning: 0
- price: total $0.001382 = input $0.000218 + output $0.001164
- prompt hash: `e6991ec8efce83c6`

- **Core VN calls** `core.vn` — 10,024 chars · ~2,728 (100.0% of input)
  - **Emotion classification** `core.vn.emotion_classification` — 10,024 chars · ~2,728 (100.0% of input)
    - piece `core.vn.emotion_classification` · owner=core · key=chunk-0 — 10,024 chars · ~2,728 · spans=[msg0:0-10024]

### Call 29: Synopsis Request

- requestId: `core.memory.synopsis.current_chapter` · callId: `llm_live_1790634100782_6` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 2,605 (cached 0) · output: 1,944 · reasoning: 0
- price: total $0.000636 = input $0.000208 + output $0.000428
- prompt hash: `8e2a65522c1e1351`

- **Core VN calls** `core.vn` — 9,426 chars · ~2,605 (100.0% of input)
  - **Core VN task** `core.vn.task` — 866 chars · ~239 (9.2% of input)
    - piece `core.vn.task` · owner=core — 866 chars · ~239 · spans=[msg3:0-866]
  - **Core VN scene** `core.vn.scene` — 8,034 chars · ~2,220 (85.2% of input)
    - piece `core.vn.scene` · owner=core — 8,034 chars · ~2,220 · spans=[msg2:0-8034]
  - **Core VN scene capsule** `core.vn.scene_capsule` — 278 chars · ~77 (2.9% of input)
    - piece `core.vn.scene_capsule` · owner=core — 278 chars · ~77 · spans=[msg1:0-278]
  - **Core VN system** `core.vn.system` — 248 chars · ~69 (2.6% of input)
    - piece `core.vn.system` · owner=core — 248 chars · ~69 · spans=[msg0:0-248]

### Call 30: Summary Request

- requestId: `core.memory.summary` · callId: `llm_live_1790634168761_24` · status: **measured**
- model: `inclusionai/ling-3.0-flash:thinking` · provider: `nano_gpt`
- provider input: 2,290 (cached 0) · output: 556 · reasoning: 0
- price: total $0.000306 = input $0.000183 + output $0.000122
- prompt hash: `8acdcd056d960979`

- **Core memory calls** `core.memory` — 8,602 chars · ~2,290 (100.0% of input)
  - **Summary content** `core.memory.summary_content` — 7,911 chars · ~2,106 (92.0% of input)
    - piece `core.memory.summary_content` · owner=core · key=turn — 7,911 chars · ~2,106 · spans=[msg1:0-7911]
  - **Summary system** `core.memory.summary_system` — 691 chars · ~184 (8.0% of input)
    - piece `core.memory.summary_system` · owner=core — 691 chars · ~184 · spans=[msg0:0-691]

### Call 31: Plugin:story_arc_tracker

- requestId: `core.vn_background` · callId: `llm_live_1790634178941_29` · status: **no-usage**
- model: `deepseek/deepseek-v4-flash-0731:thinking` · provider: `nano_gpt`
- provider input: — (cached 0) · output: 0 · reasoning: 0
- price: total $0 = input $0 + output $0
- prompt hash: `6d688ad5936ae954`

- **Shared history** `root.history` — 89,607 chars · ~—
- **Plugin tasks** `core.plugin_tasks` — 9,430 chars · ~—
  - **Story Arc Classification** `story_arc_tracker.story_arc_classification` — 9,430 chars · ~—
    - piece `story_arc_tracker.story_arc_classification` · owner=story_arc_tracker — 9,430 chars · ~— · spans=[msg2:0-9430]
- **Shared canon** `root.canon` — 39,915 chars · ~—
  - **Character canon** `character_sheets.character_canon` — 39,855 chars · ~—
    - **Sheets** `character_sheets.character_canon.sheets` — 39,855 chars · ~—
      - piece `character_sheets.character_canon.sheets` · owner=character_sheets · src=pcs-10c1d257-0935- — 39,855 chars · ~— · spans=[msg1:4204-44059]
  - **Static lore file** `core.canon.static_lore_file` — 60 chars · ~—
    - piece `core.canon.static_lore_file` · owner=core · key=static-lore-lore-0-test4.md · src=pcs-407a6439-c0ba- — 60 chars · ~— · spans=[msg1:4142-4202]
- **Shared dynamic knowledge** `root.dynamic_knowledge` — 18,129 chars · ~—
  - **Recalled memories** `memory_recall.recalled_memories` — 10,211 chars · ~—
    - **Memories** `memory_recall.recalled_memories.memories` — 10,211 chars · ~—
      - piece `memory_recall.recalled_memories.memories` · owner=memory_recall · src=pcs-bdfdab9c-b22a- — 10,211 chars · ~— · spans=[msg1:44089-54300]
  - **Lore entries** `lore_book.lore_shared_dynamic` — 7,918 chars · ~—
    - **Entries** `lore_book.lore_shared_dynamic.entries` — 7,918 chars · ~—
      - piece `lore_book.lore_shared_dynamic.entries` · owner=lore_book · src=pcs-deb8b181-7b89- — 7,918 chars · ~— · spans=[msg1:54302-62220]
- **Shared simulation** `root.simulation` — 10,377 chars · ~—
  - **World state context** `world_state_tracker.world_state_context` — 6,248 chars · ~—
    - **Current State** `world_state_tracker.world_state_context.current_state` — 6,173 chars · ~—
      - piece `world_state_tracker.world_state_context.current_state` · owner=world_state_tracker · src=pcs-e72072da-6026- — 6,173 chars · ~— · spans=[msg1:62307-68480]
  - **Location context** `world_location_tracker.location_context` — 4,129 chars · ~—
    - **Current State** `world_location_tracker.location_context.current_state` — 4,051 chars · ~—
      - piece `world_location_tracker.location_context.current_state` · owner=world_location_tracker · src=pcs-291016a4-0804- — 4,051 chars · ~— · spans=[msg1:68560-72611]
- **Shared protocol** `root.protocol` — 269 chars · ~—
  - **VN background system** `core.vn_background.system` — 269 chars · ~—
    - piece `core.vn_background.system` · owner=core — 269 chars · ~— · spans=[msg0:0-269]
- **VN background capsule** `core.vn_background.capsule` — 4,280 chars · ~—
  - **VN background brief** `core.vn_background.capsule.brief` — 3,832 chars · ~—
    - piece `core.vn_background.capsule.brief` · owner=core — 3,832 chars · ~— · spans=[msg1:292-4124]
  - **VN background input** `core.vn_background.capsule.input` — 183 chars · ~—
    - piece `core.vn_background.capsule.input` · owner=core — 183 chars · ~— · spans=[msg1:107-290]
  - **VN background project** `core.vn_background.capsule.project` — 68 chars · ~—
    - piece `core.vn_background.capsule.project` · owner=core — 68 chars · ~— · spans=[msg1:37-105]
  - **VN background knowledge** `core.vn_background.capsule.knowledge` — 30 chars · ~—
    - piece `core.vn_background.capsule.knowledge` · owner=core — 30 chars · ~— · spans=[msg1:44061-44089 msg1:54300-54302]
  - **VN background simulation** `core.vn_background.capsule.simulation` — 30 chars · ~—
    - piece `core.vn_background.capsule.simulation` · owner=core — 30 chars · ~— · spans=[msg1:62222-62250 msg1:68498-68500]
  - **VN background history** `core.vn_background.capsule.history` — 28 chars · ~—
    - piece `core.vn_background.capsule.history` · owner=core — 28 chars · ~— · spans=[msg1:72631-72659]
  - **VN background canon** `core.vn_background.capsule.canon` — 18 chars · ~—
    - piece `core.vn_background.capsule.canon` · owner=core — 18 chars · ~— · spans=[msg1:4126-4142 msg1:4202-4204]

## 5. Shared pieces (same componentId present in multiple calls)

| piece | calls |
|-------|-------|
| core.canon.static_lore_file | C1, C2, C3, C4, C5, C6, C7, C31 |
| character_sheets.character_canon.sheets | C1, C2, C3, C4, C5, C6, C7, C31 |
| memory_recall.recalled_memories.memories | C1, C2, C3, C4, C5, C6, C7, C31 |
| lore_book.lore_shared_dynamic.entries | C1, C2, C3, C4, C5, C6, C7, C31 |
| root.history | C1, C2, C3, C4, C5, C6, C7, C31 |
| world_state_tracker.world_state_context | C1, C2, C3, C4, C5, C6, C7, C31 |
| world_state_tracker.world_state_context.current_state | C1, C2, C3, C4, C5, C6, C7, C31 |
| world_location_tracker.location_context | C1, C2, C3, C4, C5, C6, C7, C31 |
| world_location_tracker.location_context.current_state | C1, C2, C3, C4, C5, C6, C7, C31 |
| core.vn.system | C10, C19, C20, C21, C22, C27, C29 |
| core.vn.scene_capsule | C10, C19, C20, C21, C22, C27, C29 |
| core.vn.task | C10, C19, C20, C21, C22, C27, C29 |
| core.vn_background.system | C4, C5, C6, C7, C31 |
| core.vn_background.capsule | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.project | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.input | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.brief | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.canon | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.knowledge | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.simulation | C4, C5, C6, C7, C31 |
| core.vn_background.capsule.history | C4, C5, C6, C7, C31 |
| core.shared.engine_contract | C1, C2, C3 |
| root.protocol | C1, C2, C3 |
| core.shared.interpretation_lock | C1, C2, C3 |
| root.canon | C1, C2, C3 |
| root.dynamic_knowledge | C1, C2, C3 |
| root.simulation | C1, C2, C3 |
| core.vn_background.scene | C4, C5, C6 |
| core.vn.scene | C21, C22, C29 |
| core.director.context_message | C1, C2 |
| core.director.task | C1, C2 |
| core.director.context | C1, C2 |
| core.director.constraints | C1, C2 |
| core.director.current_action | C1, C2 |
| core.director.analysis_instructions | C1, C2 |
| core.memory.arc_compression | C16, C25 |
| core.vn.emotion_classification | C23, C28 |

## 6. Coverage & caveats

- No provider total (pieces listed without attributed tokens): Plugin:story_arc_tracker
- "Message formatting" is message-owned separators (no component owner), shown as its own row.
- Payload token cells are attributions, not provider measurements. Only provider input/output/reasoning/cached are measured.
