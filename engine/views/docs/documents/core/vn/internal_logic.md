# VN Analysis & Logic

The Visual Novel subsystem relies on a set of analytical modules to transform LLM prose into a structured, cinematic experience. This "Brain" resides in `engine/modules/vn_manager/analysis/`.

## 1. Dialogue Processor

The `DialogueProcessor` is the entry point for turn generation. Its primary task is to extract dialogue and narration from the raw LLM response.

### Key Features
- **Fast Path Heuristic**: If the input is already formatted as `Name: Text`, the processor skips the LLM call to save time and tokens.
- **Parallel Processing**: For long turns, the text is split and processed in parallel using multiple LLM threads.
- **Validation**: It compares character and tag counts between input and output to ensure no narrative content is lost during the transformation.
- **Character Filtering**: Uses a multi-tier heuristic system to distinguish actual character names from dates, timestamps, and narrative headers (e.g., auto-rejecting "Chapter 1" or "3:00 PM").

---

## 2. Emotion Classifier

The `EmotionClassifier` assigns visual and auditory "feeling" to every dialogue line.

### Intelligence Layers
- **Sprite Awareness**: It scans the project's `assets/` directory to build a catalog of *actually available* emotions (e.g., `sandra_happy.png` exists, but `sandra_sad.png` does not).
- **Logical Constraints**: It forces the LLM to only select emotions that exist for the specific character.
- **Mood (TTS)**: Simultaneously determines the "Mood" (prosody) for text-to-speech engines.
- **Variant Locking**: Respects engine-level "locks" where a character might be forced into a specific state (e.g., "Injured" or "Wearing Armor") regardless of the dialogue tone.

---

## 3. Metadata & Gender Detection

The `GenderGuesser` provides critical context for fallback scenarios.
- **Strategy**: It first checks the narrative "Fact Registry" (established during story generation). If the gender isn't a known fact, it uses name-based detection.
- **Impact**: Used to pick the correct gendered generic sprites (NPCs) and TTS voice profiles when specific character data is missing.

---

## 4. Narrative Analysis (Experimental)

The `NarrativeAnalyzer` computes mathematical metrics to judge story quality.
- **Alternation Rate**: Measures the "Ping-Pong" effect of rapid dialogue.
- **Entropy**: Measures speaker balance.
- **Instructional Feedback**: These metrics are designed to provide automated feedback to the Writer LLM (e.g., "There are too many short lines, try a monologue").
