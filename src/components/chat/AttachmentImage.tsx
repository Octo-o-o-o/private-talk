import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { cn } from "@/lib/utils";

/** Derive thumbnail path from original: abc.png → abc_thumb.jpg */
function thumbPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return filePath;
  return `${filePath.substring(0, dot)}_thumb.jpg`;
}

interface AttachmentImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  filePath: string;
  /** When true, try to load the _thumb.jpg version first (default: false). */
  preferThumbnail?: boolean;
  fallbackClassName?: string;
}

export function AttachmentImage({
  filePath,
  preferThumbnail,
  alt,
  className,
  fallbackClassName,
  ...props
}: AttachmentImageProps) {
  const [failed, setFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  const originalSrc = useMemo(() => convertFileSrc(filePath), [filePath]);
  const thumbSrc = useMemo(
    () => (preferThumbnail ? convertFileSrc(thumbPath(filePath)) : null),
    [filePath, preferThumbnail]
  );

  // Use thumbnail if available and not failed; fall back to original
  const src = thumbSrc && !thumbFailed ? thumbSrc : originalSrc;

  useEffect(() => {
    setFailed(false);
    setThumbFailed(false);
  }, [filePath]);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground",
          fallbackClassName
        )}
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      decoding="async"
      onError={() => {
        if (thumbSrc && !thumbFailed) {
          // Thumbnail failed — fall back to original
          setThumbFailed(true);
        } else {
          setFailed(true);
        }
      }}
      {...props}
    />
  );
}
