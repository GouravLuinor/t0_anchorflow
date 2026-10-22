"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import {
  Anchor,
  BookOpen,
  ClipboardCopy,
  Compass,
  CornerDownLeft,
  MessageCircleQuestion,
  Pin,
  RotateCcw,
  Search,
  SunMoon,
  Table2,
  UserRound,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Keycap } from "@/components/ui/keycap";
import { toast } from "@/components/ui/toast";
import { cn, copyTextToClipboard } from "@/lib/utils";
import { DEFAULT_WORKFLOW } from "../_lib/presets";
import { useToolStore } from "../_store/useToolStore";
import { useAuthPromptStore } from "../_store/useAuthPromptStore";

type CommandCategory = "Navigation" | "Actions";

interface CommandItem {
  id: string;
  title: string;
  category: CommandCategory;
  hint?: string;
  icon: ReactNode;
  keycap?: string;
  /** Fifth state: a command that cannot run RIGHT NOW is listed but inert. */
  disabled?: boolean;
  disabledHint?: string;
  onSelect: () => void;
}

const CATEGORY_ORDER: CommandCategory[] = ["Navigation", "Actions"];

function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function CommandPalette() {
  const isCommandPaletteOpen = useToolStore((s) => s.isCommandPaletteOpen);
  const setCommandPaletteOpen = useToolStore((s) => s.setCommandPaletteOpen);
  const reset = useToolStore((s) => s.reset);
  const setSource = useToolStore((s) => s.setSource);
  const requestResolve = useToolStore((s) => s.requestResolve);
  const resolveStatus = useToolStore((s) => s.resolveStatus);
  const resolving = resolveStatus === "running";
  const pendingRefs = useToolStore(
    (s) => s.report.uses.filter((use) => use.cls === "remoteRef").length
  );
  const openAuthPrompt = useAuthPromptStore((s) => s.open);
  const { resolvedTheme, setTheme } = useTheme();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const close = useCallback(() => {
    setCommandPaletteOpen(false);
  }, [setCommandPaletteOpen]);

  const handleCopy = useCallback(() => {
    const rewritten = useToolStore.getState().report.rewrittenYaml;
    if (!rewritten) {
      toast({
        title: "Nothing to copy yet",
        description: "Paste a workflow first — the pinned output appears here.",
        variant: "destructive",
      });
      return;
    }
    void copyTextToClipboard(rewritten).then((succeeded) => {
      if (succeeded) {
        toast({ title: "Pinned file copied", description: "⌘⇧C" });
      } else {
        toast({ title: "Copy failed", variant: "destructive" });
      }
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const commands = useMemo<CommandItem[]>(() => {
    const navigation: CommandItem[] = [
      {
        id: "nav-workstation",
        title: "Go to the workflow",
        category: "Navigation",
        icon: <Compass className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          scrollToSection("workstation");
          close();
        },
      },
      {
        id: "nav-compare",
        title: "How it compares",
        category: "Navigation",
        icon: <Table2 className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          scrollToSection("compare");
          close();
        },
      },
      {
        id: "nav-guide",
        title: "Guide",
        category: "Navigation",
        icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          scrollToSection("guide");
          close();
        },
      },
      {
        id: "nav-faq",
        title: "FAQ",
        category: "Navigation",
        icon: <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          scrollToSection("faq");
          close();
        },
      },
    ];

    const actions: CommandItem[] = [
      {
        id: "action-resolve",
        title: "Resolve & pin",
        category: "Actions",
        hint: "Resolve every pending ref to a commit SHA",
        icon: <Pin className="h-4 w-4" aria-hidden="true" />,
        keycap: "⌘⏎",
        // Disabled unless there is something to spend the hourly quota on —
        // the same gate the toolbar's button uses, so the two can never
        // disagree about whether a resolve is possible.
        disabled: pendingRefs === 0 || resolving,
        disabledHint:
          pendingRefs === 0
            ? "Every ref is already pinned — nothing to resolve"
            : "A resolve is already running",
        onSelect: () => {
          requestResolve();
          close();
        },
      },
      {
        id: "action-copy",
        title: "Copy pinned file",
        category: "Actions",
        icon: <ClipboardCopy className="h-4 w-4" aria-hidden="true" />,
        keycap: "⌘⇧C",
        onSelect: () => {
          handleCopy();
          close();
        },
      },
      {
        id: "action-example",
        title: "Insert example workflow",
        category: "Actions",
        hint: "Re-seed the editor with the built-in sample",
        icon: <Anchor className="h-4 w-4" aria-hidden="true" />,
        keycap: "⌘P",
        onSelect: () => {
          setSource(DEFAULT_WORKFLOW);
          close();
        },
      },
      {
        id: "action-theme",
        title: "Switch light / dark theme",
        category: "Actions",
        icon: <SunMoon className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          handleToggleTheme();
          close();
        },
      },
      {
        id: "action-reset",
        title: "Clear the editor",
        category: "Actions",
        icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          reset();
          close();
        },
      },
      {
        id: "action-sign-in",
        title: "Sign in",
        category: "Actions",
        icon: <UserRound className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          openAuthPrompt("manual");
          close();
        },
      },
    ];

    return [...navigation, ...actions];
  }, [
    close,
    handleCopy,
    handleToggleTheme,
    openAuthPrompt,
    pendingRefs,
    requestResolve,
    resolving,
    reset,
    setSource,
  ]);

  const filtered = useMemo(
    () =>
      commands.filter((command) =>
        command.title.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [commands, query]
  );

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: filtered
          .map((item, index) => ({ item, index }))
          .filter((entry) => entry.item.category === category),
      })),
    [filtered]
  );

  // Reopen resets the query and the active option, then focuses the search
  // input (the ⌘K contract the e2e journey relies on).
  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    setQuery("");
    setSelectedIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isCommandPaletteOpen]);

  // Keep the active option scrolled into view as ArrowUp/Down or hover moves it.
  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    const active = document.getElementById(`${listId}-opt-${selectedIndex}`);
    active?.scrollIntoView({ block: "nearest" });
  }, [isCommandPaletteOpen, listId, selectedIndex]);

  const activeOptionId =
    filtered.length > 0 ? `${listId}-opt-${selectedIndex}` : undefined;

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex(
        (previous) => (previous + 1) % Math.max(filtered.length, 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex(
        (previous) =>
          (previous - 1 + filtered.length) % Math.max(filtered.length, 1)
      );
      return;
    }
    if (event.key === "Enter") {
      if (event.metaKey || event.ctrlKey) {
        // ⌘⏎ is the page-level resolve chord's palette twin: it runs Resolve &
        // pin without moving the selection. A disabled action does nothing.
        const resolve = commands.find((command) => command.id === "action-resolve");
        if (resolve && !resolve.disabled) {
          event.preventDefault();
          resolve.onSelect();
        }
        return;
      }
      // Shift+Enter belongs to page shortcuts — never run an option.
      if (event.shiftKey) return;
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command && !command.disabled) {
        command.onSelect();
        close();
      }
    }
  };

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent
        className="top-[10vh] flex max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded border border-line-strong bg-sheet p-0 shadow-pop [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-3 border-b border-line bg-band px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          <input
            ref={inputRef}
            id="command-palette-search-input"
            name="command-palette-search"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command…"
            aria-label="Command palette search"
            role="combobox"
            aria-expanded={true}
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            className="w-full rounded bg-transparent font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
          />
          <Keycap size="xs">ESC</Keycap>
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-ink-3">
              No matching commands.
            </div>
          ) : (
            grouped.map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.category} className="mb-1 last:mb-0">
                  <div className="px-3 pb-1 pt-2 text-[12px] font-semibold text-ink-3">
                    {group.category}
                  </div>
                  {group.items.map(({ item, index }) => {
                    const isSelected = index === selectedIndex;
                    const disabled = item.disabled === true;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-opt-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={disabled || undefined}
                        tabIndex={-1}
                        onClick={() => {
                          if (disabled) return;
                          item.onSelect();
                          close();
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded border px-3 py-2 transition-colors duration-150 ease-out-expo",
                          disabled
                            ? "cursor-not-allowed border-transparent text-ink-3 opacity-60"
                            : cn(
                                "cursor-pointer",
                                isSelected
                                  ? "border-line-strong bg-sunk text-ink"
                                  : "border-transparent text-ink-2 hover:bg-sunk/60",
                                ""
                              )
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "shrink-0",
                              disabled
                                ? "text-ink-3"
                                : isSelected
                                  ? "text-seal"
                                  : "text-ink-3"
                            )}
                          >
                            {item.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {item.title}
                            </span>
                            {item.hint || item.disabledHint ? (
                              <span className="block truncate text-xs text-ink-3">
                                {disabled ? item.disabledHint : item.hint}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {item.keycap ? (
                            <Keycap size="xs">{item.keycap}</Keycap>
                          ) : null}
                          {isSelected ? (
                            <CornerDownLeft
                              className="h-3.5 w-3.5 text-seal"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )
            )
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-band px-4 py-2 font-mono text-[10px] text-ink-3 select-none">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Keycap size="xs">↑</Keycap>
              <Keycap size="xs">↓</Keycap> Navigate
            </span>
            <span className="flex items-center gap-1">
              <Keycap size="xs">↵</Keycap> Select
            </span>
          </div>
          <span className="font-semibold text-ink-2">Anchorflow</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
