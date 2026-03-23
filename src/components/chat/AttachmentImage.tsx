import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { cn } from "@/lib/utils";

interface AttachmentImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  filePath: string;
  fallbackClassName?: string;
}

export function AttachmentImage({
  filePath,
  alt,
  className,
  fallbackClassName,
  ...props
}: AttachmentImageProps) {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => convertFileSrc(filePath), [filePath]);

  useEffect(() => {
    setFailed(false);
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
      onError={() => setFailed(true)}
      {...props}
    />
  );
}
