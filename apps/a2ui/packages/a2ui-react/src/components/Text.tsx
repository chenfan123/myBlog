import { useMountAnimation } from "../mount-animation.js";

interface TextProps {
  text?: string;
  usageHint?: string;
  componentId?: string;
  hasMounted?: boolean;
}

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5"]);

type TextTag = "h1" | "h2" | "h3" | "h4" | "h5" | "p";

/** A2UI Text：按 usageHint 渲染标题或正文。 */
export function Text({
  text = "",
  usageHint = "body",
  componentId,
  hasMounted,
}: TextProps) {
  const Tag: TextTag = headingTags.has(usageHint) ? (usageHint as TextTag) : "p";
  const mount = useMountAnimation(componentId, hasMounted);
  return (
    <Tag
      data-a2ui="Text"
      data-a2ui-id={componentId}
      data-usage-hint={usageHint}
      className={mount.className}
      onAnimationEnd={mount.onAnimationEnd}
    >
      {text}
    </Tag>
  );
}
