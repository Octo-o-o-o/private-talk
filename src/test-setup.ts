import "@testing-library/jest-dom/vitest";

// Intentionally NO import of the app store here.
// Importing the store eagerly in setup would also import `lib/tauri`, which
// would lock the real module into the worker's module cache before any test
// file's `vi.mock("../lib/tauri", ...)` has a chance to replace it.
// Tests that need to reset the store should snapshot the initial state
// themselves (see `src/stores/appStore.actions.test.ts`).
