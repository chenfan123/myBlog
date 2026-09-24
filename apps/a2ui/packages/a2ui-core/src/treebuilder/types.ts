/**
 * 组件树：从 root 出发，按 parent/child 把 hydrateNode 组装后的可挂载结果。
 * 叶子是 renderMap 产出的实例；容器会再 render 一次，并把子树放进 props.children。
 */
export type ComponentTree = unknown;
