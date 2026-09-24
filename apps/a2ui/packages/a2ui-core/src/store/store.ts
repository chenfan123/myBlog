import { createStore, type StoreApi } from "zustand/vanilla";
import type { InitOptions, OnUserActionFn } from "./render-map.js";
import type { A2UIError, A2UIStore, HydrateNode, RenderMap, Surface } from "./types.js";

const initialState = {
  renderMap: {} as RenderMap,
  surfaceMap: {} as Record<string, Surface>,
  hydrateNodeMap: {} as Record<string, HydrateNode>,
  errorMap: {} as Record<string, A2UIError>,
};

function omitKey<T extends Record<string, unknown>>(record: T, key: string): T {
  const { [key]: _, ...rest } = record;
  return rest as T;
}

export function createA2UIStore(options: InitOptions = {}): StoreApi<A2UIStore> {
  return createStore<A2UIStore>()((set, get) => ({
    ...initialState,
    renderMap: options.renderMap ?? {},
    renderTree: options.renderTree,
    onUserAction: options.onUserAction,

    setRenderMap: (renderMap) => {
      set({ renderMap });
    },
    setRenderTree: (renderTree) => {
      set({ renderTree });
    },
    setOnUserAction: (onUserAction: OnUserActionFn | undefined) => {
      set({ onUserAction });
    },

    addSurface: (surface) => {
      set((state) => ({
        surfaceMap: {
          ...state.surfaceMap,
          [surface.surfaceId]: surface,
        },
      }));
    },
    getSurface: (surfaceId) => get().surfaceMap[surfaceId],
    updateSurface: (surfaceId, patch) => {
      set((state) => {
        const current = state.surfaceMap[surfaceId];
        if (!current) {
          return state;
        }

        return {
          surfaceMap: {
            ...state.surfaceMap,
            [surfaceId]: { ...current, ...patch, surfaceId },
          },
        };
      });
    },
    deleteSurface: (surfaceId) => {
      set((state) => {
        if (!(surfaceId in state.surfaceMap)) {
          return state;
        }

        return {
          surfaceMap: omitKey(state.surfaceMap, surfaceId),
        };
      });
    },

    addHydrateNode: (node) => {
      set((state) => ({
        hydrateNodeMap: {
          ...state.hydrateNodeMap,
          [node.componentId]: node,
        },
      }));
    },
    getHydrateNode: (componentId) => get().hydrateNodeMap[componentId],
    updateHydrateNode: (componentId, patch) => {
      set((state) => {
        const current = state.hydrateNodeMap[componentId];
        if (!current) {
          return state;
        }

        return {
          hydrateNodeMap: {
            ...state.hydrateNodeMap,
            [componentId]: { ...current, ...patch, componentId },
          },
        };
      });
    },
    deleteHydrateNode: (componentId) => {
      set((state) => {
        if (!(componentId in state.hydrateNodeMap)) {
          return state;
        }

        return {
          hydrateNodeMap: omitKey(state.hydrateNodeMap, componentId),
        };
      });
    },
    markHydrateNodeMounted: (componentId) => {
      const current = get().hydrateNodeMap[componentId];
      if (!current || current.hasMounted) {
        return;
      }
      get().updateHydrateNode(componentId, { hasMounted: true });
    },

    addError: (error) => {
      set((state) => ({
        errorMap: {
          ...state.errorMap,
          [error.id]: error,
        },
      }));
    },
    getError: (id) => get().errorMap[id],
    updateError: (id, patch) => {
      set((state) => {
        const current = state.errorMap[id];
        if (!current) {
          return state;
        }

        return {
          errorMap: {
            ...state.errorMap,
            [id]: { ...current, ...patch, id },
          },
        };
      });
    },
    deleteError: (id) => {
      set((state) => {
        if (!(id in state.errorMap)) {
          return state;
        }

        return {
          errorMap: omitKey(state.errorMap, id),
        };
      });
    },
  }));
}

let store: StoreApi<A2UIStore> | undefined;

/** 初始化全局 store，并注入宿主提供的 renderMap / renderTree / onUserAction。 */
export function init(options: InitOptions = {}): StoreApi<A2UIStore> {
  store = createA2UIStore(options);
  return store;
}

export function initStore(options: InitOptions = {}): StoreApi<A2UIStore> {
  return init(options);
}

export function getA2UIStore(): StoreApi<A2UIStore> {
  return store ?? init();
}

export function resetA2UIStore(options: InitOptions = {}): StoreApi<A2UIStore> {
  return init(options);
}

/** 入场动画结束时由宿主渲染器调用，把对应 hydrateNode.hasMounted 置为 true。 */
export function markHydrateNodeMounted(componentId: string): void {
  getA2UIStore().getState().markHydrateNodeMounted(componentId);
}
