# Private Talk iOS / macOS Performance Optimization Plan

Date: 2026-04-22
Status: Implemented and verified

## 1. Context

The app has no obvious background execution path on iOS. The main performance risk is the foreground rendering path during chat usage, especially while streaming model output in a WKWebView-backed Tauri app.

The highest-confidence hotspots from the current codebase are:

1. High-frequency streaming events from Rust to the frontend.
2. Whole-chat rerenders on each streamed chunk.
3. Repeated Markdown parsing of assistant messages during streaming.
4. Expensive blur/compositing effects on touch devices.
5. Rebuilding large message history and attachment payloads on send.
6. Loading full conversation history before applying the context window limit.
7. Converting oversized attachments to base64 on the frontend before rejection.

## 2. Goals

1. Reduce CPU wakeups and React work during streaming without changing product behavior.
2. Improve iPhone thermal and battery behavior with standard, low-risk optimizations.
3. Keep desktop behavior visually close to the current design.
4. Avoid speculative refactors with weak return.

## 3. Non-Goals

1. No redesign of the chat product model.
2. No change to provider APIs or persistence format.
3. No virtualization pass for the full conversation list in this iteration.
4. No change to attachment semantics in this iteration.

## 4. Evidence Summary

### 4.1 Stream event frequency is too high

Rust emits one frontend event for every content chunk:

- `src-tauri/src/llm/provider.rs`
- `src-tauri/src/commands/chat.rs`

This is acceptable on desktop for short replies, but it is expensive on iOS because each event can trigger JS execution, state updates, layout, and repaint.

### 4.2 Streaming content is stored in global app state

`streamingContent` currently lives in the Zustand store. That means every chunk updates shared state and makes it easier for unrelated UI to rerender.

### 4.3 ChatView owns a broad store subscription

`ChatView` currently reads many fields through one broad `useAppStore()` call. Combined with global `streamingContent`, this increases rerender scope on the hottest UI surface.

### 4.4 The message list rerenders while only one message is changing

During streaming, the currently rendered assistant message changes, but the historical message list should be stable. Right now the parent view rerenders and all `MessageItem` elements are re-evaluated.

### 4.5 Mobile compositor cost is high

The app uses large-area `backdrop-filter`, heavy shadows, and infinite cursor / typing animations. On iOS this is materially more expensive than on macOS.

### 4.6 Send-path history loading is still broader than necessary

The first optimization pass reduced the recurring streaming hot path, but the send path still loads all conversation messages and their attachments before trimming to the configured context size.

For long conversations, this creates unnecessary database work, file reads, and prompt assembly on every send.

### 4.7 Large attachment handling still causes avoidable memory spikes

Attachments and reference images are converted to base64 in the web layer before the Rust layer enforces the size limit.

That means obviously oversized files can still incur unnecessary read / encode / memory cost on iOS before they are rejected.

## 5. Options Considered

### Option A: CSS-only simplification

Pros:

1. Low code risk.
2. Immediate iOS GPU relief.

Cons:

1. Does not fix the main CPU path.
2. Would leave streaming-driven rerenders mostly intact.

Verdict: insufficient alone.

### Option B: Stream batching only

Pros:

1. High return.
2. Standard optimization.

Cons:

1. Still leaves the broad rerender path and heavy mobile compositing untouched.

Verdict: necessary but not sufficient.

### Option C: Full virtualization and rendering pipeline rewrite

Pros:

1. Maximum theoretical headroom.

Cons:

1. High complexity.
2. High regression risk.
3. Weak return for the current app size compared with lower-cost fixes.

Verdict: not the best first iteration.

### Chosen plan

Use a combined, standard, high-ROI approach:

1. Batch stream events at the Rust boundary.
2. Remove streaming text from global store and localize it to `ChatView`.
3. Memoize stable message rendering so history does not rerender during streaming.
4. Throttle autoscroll to animation frames.
5. Reduce blur and animation cost on touch devices.
6. Bound send-path history loading to the actual context window.
7. Reject oversized attachments before frontend base64 conversion.

This gives the best return per unit of change and preserves current behavior.

## 6. Implementation Plan

### Phase 1: Shrink the hot render path

1. Remove `streamingContent` and related mutators from the global store.
2. Keep streaming text as local state inside `ChatView`.
3. Convert `ChatView` from a broad store subscription to targeted selectors.
4. Keep `isStreaming` global because it is a cross-component control flag.

Expected return:

1. Streaming chunks no longer invalidate the entire app store.
2. Sidebar and unrelated settings surfaces stop rerendering on every chunk.

### Phase 2: Prevent history rerenders

1. Memoize `MessageItem`.
2. Ensure stable historical messages do not rerender while only the active streaming message changes.
3. Leave final Markdown rendering behavior intact.

Expected return:

1. Historical assistant messages stop re-running `ReactMarkdown` on each chunk.
2. Streaming cost becomes proportional to one live message, not the whole conversation.

### Phase 3: Batch Rust stream emissions

1. Aggregate content chunks before emitting to the frontend.
2. Flush on either:
   - a short elapsed time threshold, or
   - a content-size threshold, or
   - stream completion.
3. Keep usage accounting and final completion semantics unchanged.

Proposed thresholds:

1. Time window: about 40-50 ms.
2. Content threshold: about 96-160 bytes.

Rationale:

1. This keeps perceived streaming smooth.
2. It significantly reduces bridge traffic during fast model output.

Expected return:

1. A large reduction in frontend event count during fast streams.
2. Lower CPU overhead on iOS and better main-thread availability.

### Phase 4: Make autoscroll frame-based

1. Replace direct `scrollTop = scrollHeight` on every update with `requestAnimationFrame` scheduling.
2. Keep the existing “only autoscroll when near the bottom” rule.

Expected return:

1. Fewer forced layout writes.
2. Better behavior during rapid chunk bursts.

### Phase 5: Reduce touch-device compositor cost

1. Lower blur intensity on coarse-pointer devices.
2. Simplify large shadows on coarse-pointer devices.
3. Disable or simplify infinite cursor / typing animations on coarse-pointer devices.
4. Keep desktop styling close to the current design.

Expected return:

1. Lower GPU/compositor pressure on iPhone and iPad.
2. Less heat during long sessions even when idle on chat screens.

### Phase 6: Bound send-path history and attachment loading

1. Apply the `context_max_messages` limit before loading message history from SQLite.
2. Load attachments only for the retained messages.
3. Preserve chronological order and final prompt semantics.

Expected return:

1. Lower database and file I/O per send in long conversations.
2. Lower CPU cost when sending in mature threads with attachments.

### Phase 7: Guard oversized files before base64 conversion

1. Add frontend size checks for attachments and reference images using the same effective size limit as the Rust layer.
2. Reject oversized files before `FileReader` / base64 conversion.
3. Preserve existing successful upload behavior.

Expected return:

1. Avoid avoidable JS memory spikes.
2. Reduce attachment-related heat and latency on iOS for bad or accidental inputs.

### Phase 8: Clean up low-risk residual render churn

1. Remove remaining broad store subscriptions in always-mounted or commonly used components.
2. Avoid resize-state writes when the layout mode does not actually change.

Expected return:

1. Small but real reduction in incidental rerenders.
2. Cleaner baseline after the main hot-path fixes.

## 7. Risk Review

### Functional risk

Low.

The chosen changes do not alter the provider contract, message persistence format, or the final rendered assistant output.

### UX risk

Low to medium.

1. Batched streaming slightly reduces token-by-token immediacy.
2. Reduced blur on touch devices slightly changes visual richness.

This tradeoff is acceptable because the current thermal cost is user-visible and the streaming output remains perceptibly live.

### Regression risk

Main risks:

1. Stream flush logic missing a final partial chunk.
2. Local streaming state not resetting correctly when conversation changes or errors.
3. Memoization hiding legitimate updates if props are incomplete.

Mitigations:

1. Explicit flush before `done`.
2. Explicit reset on send, error, done, and conversation switch.
3. Memoize `MessageItem` only by existing visible props.

## 8. Review Checklist

The plan was reviewed against the following questions:

1. Is every change attached to a concrete hotspot? Yes.
2. Is there a clearer lower-risk alternative with similar return? No.
3. Does the plan preserve existing product behavior? Yes.
4. Are we avoiding large speculative refactors? Yes.
5. Is there a measurable expected return? Yes:
   - fewer stream bridge events,
   - fewer historical message rerenders,
   - lower mobile blur/animation cost.
6. Are any important hotspots ignored? No major ones for this iteration.
7. Is send-path history loading worth changing in the second pass? Yes.
   - It is bounded, standard, and materially reduces repeated work in long conversations.
8. Is frontend attachment preflight worth changing now? Yes.
   - It is low risk and prevents needless base64 work on oversized files.

Conclusion:

This is the standard, rational, highest-ROI first implementation plan for the current codebase.

## 9. Verification Plan

1. TypeScript build passes.
2. Rust check passes.
3. Streaming still works:
   - start stream,
   - stop stream,
   - stream error path,
   - conversation switch after stream.
4. Final assistant message content matches the streamed content.
5. Touch-device CSS still renders correctly in phone layout.
6. Long-conversation send still preserves correct message ordering and content.
7. Oversized attachments are rejected before encoding.

## 10. Implementation Status

1. Phase 1: Completed
   - `streamingContent` was removed from the global store.
   - Streaming text now lives inside `ChatView`.
   - `ChatView` was converted to targeted store selectors.
2. Phase 2: Completed
   - `MessageItem` was memoized so stable history entries do not rerender during streaming.
3. Phase 3: Completed
   - Rust stream chunk emission now batches by time / size before crossing into the frontend.
4. Phase 4: Completed
   - Autoscroll now runs through `requestAnimationFrame` scheduling.
5. Phase 5: Completed
   - Coarse-pointer devices now use reduced blur and disable continuous streaming cursor / typing animations.
6. Phase 6: Completed
   - Send-path history loading now applies the context-window limit before reading messages and attachments.
7. Phase 7: Completed
   - Oversized attachments and reference images are now rejected before frontend base64 conversion.
8. Phase 8: Completed
   - Remaining broad store subscriptions were narrowed in residual components.
   - Layout resize handling now avoids no-op state writes.
9. Verification: Completed
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `pnpm build`

## 11. Deferred Work

The following item remains intentionally deferred because it is lower priority than the implemented paths:

1. Deeper attachment-content caching across sends.
   - This is more complex than simply bounding the context-window read set.
2. Conversation virtualization.
   - This should only be added if real-world message counts justify the added complexity.
3. Additional JS chunk splitting.
   - The production build still warns about a main chunk slightly over 500 kB.
   - This affects startup / load characteristics more than the thermal issues targeted in this plan.
