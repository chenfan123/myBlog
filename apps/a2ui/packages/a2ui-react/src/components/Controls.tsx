import { useState, type CSSProperties, type ReactNode } from "react";
import { updateModel } from "a2ui-core";
import { triggerAction } from "../action.js";
import type { HostProps } from "../host.js";
import { useHost } from "../host.js";

const fieldStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 44,
  margin: 0,
  padding: "0 12px",
  border: "0",
  borderRadius: 12,
  fontSize: 17,
  lineHeight: "22px",
  fontFamily: "inherit",
  color: "var(--a2ui-text, #1d1d1f)",
  background: "var(--a2ui-fill, #f5f5f7)",
};

const textareaStyle: CSSProperties = {
  ...fieldStyle,
  height: "auto",
  minHeight: 72,
  padding: "8px 10px",
  resize: "vertical",
};

interface ActionContextValue {
  path?: string;
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
}

interface ComponentAction {
  name?: string;
  context?: Array<{ key: string; value?: ActionContextValue }>;
}

interface BoundHostProps extends HostProps {
  surfaceId?: string;
}

function writeBound(surfaceId: string | undefined, path: string | undefined, value: unknown) {
  if (!surfaceId || !path) {
    return;
  }
  updateModel(surfaceId, path, value);
}

export function Button({
  children,
  primary,
  action,
  componentId,
  surfaceId,
  hasMounted,
}: BoundHostProps & { children?: ReactNode; primary?: boolean; action?: ComponentAction }) {
  const host = useHost("Button", componentId, hasMounted);
  return (
    <button
      {...host.attrs}
      type="button"
      data-primary={primary ? "true" : undefined}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      onClick={() => {
        if (!action?.name || !surfaceId) {
          return;
        }
        triggerAction({
          name: action.name,
          surfaceId,
          sourceComponentId: componentId ?? "",
          context: action.context,
        });
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "flex-start",
        width: "fit-content",
        gap: 6,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function CheckBox({
  label = "",
  value,
  valuePath,
  componentId,
  surfaceId,
  hasMounted,
}: BoundHostProps & { label?: string; value?: boolean; valuePath?: string }) {
  const host = useHost("CheckBox", componentId, hasMounted);
  const bound = Boolean(surfaceId && valuePath);
  const [local, setLocal] = useState(Boolean(value));
  const checked = bound ? Boolean(value) : local;
  return (
    <label
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 8 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          const next = event.target.checked;
          if (bound) {
            writeBound(surfaceId, valuePath, next);
            return;
          }
          setLocal(next);
        }}
      />
      {label}
    </label>
  );
}

function inputType(textFieldType: string | undefined): string {
  switch (textFieldType) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "obscured":
      return "password";
    default:
      return "text";
  }
}

export function TextField({
  label = "",
  text = "",
  textPath,
  textFieldType = "shortText",
  validationRegexp,
  componentId,
  surfaceId,
  hasMounted,
}: BoundHostProps & {
  label?: string;
  text?: string;
  textPath?: string;
  textFieldType?: string;
  validationRegexp?: string;
}) {
  const host = useHost("TextField", componentId, hasMounted);
  const bound = Boolean(surfaceId && textPath);
  const [local, setLocal] = useState(text);
  const value = bound ? (text ?? "") : local;
  const pattern = validationRegexp || undefined;

  function onChange(next: string) {
    if (bound) {
      writeBound(surfaceId, textPath, next);
      return;
    }
    setLocal(next);
  }

  const field =
    textFieldType === "longText" ? (
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        style={textareaStyle}
      />
    ) : (
      <input
        type={inputType(textFieldType)}
        value={value}
        pattern={pattern}
        onChange={(event) => onChange(event.target.value)}
        style={fieldStyle}
      />
    );

  return (
    <label
      {...host.attrs}
      data-text-field-type={textFieldType}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "0 0 auto",
        gap: 6,
        width: "100%",
        minWidth: 0,
        alignSelf: "stretch",
      }}
    >
      <span style={{ fontSize: 13, color: "#86868b", fontWeight: 400 }}>{label}</span>
      {field}
    </label>
  );
}

export function DateTimeInput({
  value = "",
  valuePath,
  enableDate = true,
  enableTime = true,
  componentId,
  surfaceId,
  hasMounted,
}: BoundHostProps & { value?: string; valuePath?: string; enableDate?: boolean; enableTime?: boolean }) {
  const host = useHost("DateTimeInput", componentId, hasMounted);
  const bound = Boolean(surfaceId && valuePath);
  const [local, setLocal] = useState(value);
  const current = bound ? value : local;
  const type = enableDate && enableTime ? "datetime-local" : enableTime ? "time" : "date";
  return (
    <input
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      type={type}
      value={current}
      onChange={(event) => {
        const next = event.target.value;
        if (bound) {
          writeBound(surfaceId, valuePath, next);
          return;
        }
        setLocal(next);
      }}
      style={{ ...fieldStyle, width: "auto", minWidth: 220, maxWidth: "100%", alignSelf: "flex-start" }}
    />
  );
}

export function MultipleChoice({
  options = [],
  selections = [],
  selectionsPath,
  variant = "checkbox",
  filterable,
  maxAllowedSelections,
  componentId,
  surfaceId,
  hasMounted,
}: BoundHostProps & {
  options?: Array<{ label?: string; value: string }>;
  selections?: string[];
  selectionsPath?: string;
  variant?: string;
  filterable?: boolean;
  maxAllowedSelections?: number;
}) {
  const host = useHost("MultipleChoice", componentId, hasMounted);
  const bound = Boolean(surfaceId && selectionsPath);
  const [local, setLocal] = useState<string[]>(selections);
  const [query, setQuery] = useState("");
  const selected = bound ? selections : local;
  const visible = options.filter((option) =>
    (option.label || option.value).toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(optionValue: string) {
    const next = selected.includes(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : maxAllowedSelections && selected.length >= maxAllowedSelections
        ? selected
        : [...selected, optionValue];
    if (bound) {
      writeBound(surfaceId, selectionsPath, next);
      return;
    }
    setLocal(next);
  }

  return (
    <div
      {...host.attrs}
      data-variant={variant}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {filterable ? (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter"
          style={fieldStyle}
        />
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {visible.map((option) => {
          const active = selected.includes(option.value);
          if (variant === "chips") {
            return (
              <button
                key={option.value}
                type="button"
                data-selected={active}
                onClick={() => toggle(option.value)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 980,
                  border: 0,
                  background: active ? "#1d1d1f" : "#f5f5f7",
                  color: active ? "#fff" : "#1d1d1f",
                  cursor: "pointer",
                }}
              >
                {option.label || option.value}
              </button>
            );
          }
          return (
            <label key={option.value} style={{ display: "inline-flex", gap: 6 }}>
              <input type="checkbox" checked={active} onChange={() => toggle(option.value)} />
              {option.label || option.value}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function Slider({
  value = 0,
  valuePath,
  minValue = 0,
  maxValue = 100,
  componentId,
  surfaceId,
  hasMounted,
}: BoundHostProps & { value?: number; valuePath?: string; minValue?: number; maxValue?: number }) {
  const host = useHost("Slider", componentId, hasMounted);
  const bound = Boolean(surfaceId && valuePath);
  const [local, setLocal] = useState(value);
  const current = bound ? value : local;
  return (
    <input
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      type="range"
      min={minValue}
      max={maxValue}
      value={current}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (bound) {
          writeBound(surfaceId, valuePath, next);
          return;
        }
        setLocal(next);
      }}
      style={{
        width: "100%",
        maxWidth: 420,
        height: 16,
        margin: 0,
        alignSelf: "flex-start",
        accentColor: "var(--a2ui-primary, #1d1d1f)",
      }}
    />
  );
}
