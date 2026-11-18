# External model integration backup

This branch preserves the pre-removal model integration. The project files at the root are the previously published GitHub revision. This folder contains source snapshots from the newer local implementation.

- `planner.js` is the pre-removal planner, including the DeepSeek/OpenAI-compatible and Anthropic clients, prompts, and response validation.
- `knowledgeLoader.js` loads the local sources used to build the model's instructions.

To restore the newer integration into a future version, port the provider and prompt code from these snapshots into `src/coach/` while keeping the current planner's rules. The newer snapshots expect the current local project's `planRules.js`, `storage/checkins.js`, and metrics helpers. The root of this branch also retains the earlier runnable implementation and configuration examples.

No credentials, local configuration, or training records are included in this archive.
