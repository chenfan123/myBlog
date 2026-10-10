import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartLine } from "../types";

type CartState = {
  lines: CartLine[];
  add: (productId: number) => void;
  change: (productId: number, quantity: number) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (productId) => set((state) => {
        const existing = state.lines.find((line) => line.productId === productId);
        return {
          lines: existing
            ? state.lines.map((line) => line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line)
            : [...state.lines, { productId, quantity: 1 }],
        };
      }),
      change: (productId, quantity) => set((state) => ({
        lines: quantity <= 0
          ? state.lines.filter((line) => line.productId !== productId)
          : state.lines.map((line) => line.productId === productId ? { ...line, quantity } : line),
      })),
      clear: () => set({ lines: [] }),
    }),
    {
      name: "atelier-cart",
      version: 1,
      partialize: (state) => ({ lines: state.lines }),
    },
  ),
);
