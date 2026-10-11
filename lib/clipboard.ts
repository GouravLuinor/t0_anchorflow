/**
 * Clipboard boundary for Anchorflow.
 *
 * `copyTextToClipboard` in `lib/utils.ts` is the single implementation used by
 * every copy affordance (per-pane buttons, the ⌘⇧C shortcut and the command
 * palette), so the tactile brand-lime success toast and the rose failure toast
 * are the only two outcomes anywhere in the app. Kept as a named re-export so
 * components import the intent, not the utility bag.
 */

export { copyTextToClipboard } from "./utils";
