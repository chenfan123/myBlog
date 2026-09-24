export type SurfaceTheme = "apple" | "minimal";
export type SurfaceFormFactor = "mobile" | "desktop";

/** beginRendering.styles 的本仓库形状。官方字段 font / primaryColor，其余为 catalog 扩展 token。 */
export interface SurfaceStyles {
  theme?: SurfaceTheme;
  font?: string;
  primaryColor?: string;
  background?: string;
  surfaceColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  radius?: number;
  /** 缺省 mobile。用户明确 PC 或参考图是宽屏桌面时用 desktop。 */
  formFactor?: SurfaceFormFactor;
}
