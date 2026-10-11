"use client";

import { create } from "zustand";
import type { AuthTrigger } from "../_lib/authGate";

interface AuthPromptState {
  isOpen: boolean;
  trigger: AuthTrigger | null;
  open: (trigger: AuthTrigger) => void;
  close: () => void;
}

export const useAuthPromptStore = create<AuthPromptState>()((set) => ({
  isOpen: false,
  trigger: null,
  open: (trigger) => set({ isOpen: true, trigger }),
  close: () => set({ isOpen: false, trigger: null }),
}));
