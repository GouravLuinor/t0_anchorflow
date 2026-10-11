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
        toast({ title: "Diagnostic output copied", description: "⌘⇧C" });
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
        title: "Go to Workstation",
        category: "Navigation",
        icon: <Compass className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          scrollToSection("workstation");
          close();
        },
      },
      {
        id: "nav-matrix",
        title: "Why Anchorflow",
        category: "Navigation",
        icon: <Table2 className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          scrollToSection("matrix");
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
        id: "action-copy",
        title: "Copy Diagnostic Output",
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
        title: "Insert Example Workflow",
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
        title: "Toggle Dark / Light Theme",
        category: "Actions",
        icon: <SunMoon className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          handleToggleTheme();
          close();
        },
      },
      {
        id: "action-reset",
        title: "Clear the Editor",
        category: "Actions",
        icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          reset();
          close();
        },
      },
      {
        id: "action-sign-in",
        title: "Sign In to Anchorflow",
        category: "Actions",
        icon: <UserRound className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          openAuthPrompt("manual");
          close();
        },
      },
    ];

    return [...navigation, ...actions];
  }, [close, handleCopy, handleToggleTheme, openAuthPrompt, reset, setSource]);

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
      // Modifier+Enter belongs to page shortcuts — never run an option.
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) {
        command.onSelect();
        close();
      }
    }
  };

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent
        className="top-[10vh] flex max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border border-surface-border bg-surface-default p-0 shadow-elevated [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-3 border-b border-surface-border bg-surface-subtle px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
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
            className="w-full rounded-md bg-transparent font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
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
            <div className="px-3 py-6 text-center font-mono text-xs text-zinc-500">
              No matching commands.
            </div>
          ) : (
            grouped.map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.category} className="mb-1 last:mb-0">
                  <div className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                    {group.category}
                  </div>
                  {group.items.map(({ item, index }) => {
                    const isSelected = index === selectedIndex;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-opt-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onClick={() => {
                          item.onSelect();
                          close();
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-[background-color,border-color,color,transform] duration-150 ease-out-expo motion-reduce:transition-none",
                          isSelected
                            ? "border-surface-borderHover bg-surface-elevated text-zinc-100"
                            : "border-transparent text-zinc-300 hover:border-surface-border hover:bg-surface-elevated/50",
                          "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "shrink-0",
                              isSelected ? "text-brand-lime" : "text-zinc-400"
                            )}
                          >
                            {item.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {item.title}
                            </span>
                            {item.hint ? (
                              <span className="block truncate text-xs text-zinc-500">
                                {item.hint}
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
                              className="h-3.5 w-3.5 text-brand-lime"
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

        <div className="flex items-center justify-between gap-4 border-t border-surface-border bg-surface-subtle/50 px-4 py-2 font-mono text-[10px] text-zinc-500 select-none">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Keycap size="xs">↑</Keycap>
              <Keycap size="xs">↓</Keycap> Navigate
            </span>
            <span className="flex items-center gap-1">
              <Keycap size="xs">↵</Keycap> Select
            </span>
          </div>
          <span className="font-medium text-zinc-400">Anchorflow</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
