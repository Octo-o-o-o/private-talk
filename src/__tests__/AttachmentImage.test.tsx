import { fireEvent, render, screen } from "@testing-library/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentImage } from "@/components/chat/AttachmentImage";

describe("AttachmentImage", () => {
  beforeEach(() => {
    vi.mocked(convertFileSrc).mockImplementation((path: string) => `asset://${path}`);
  });

  it("prefers the thumbnail and falls back to the original file after a thumbnail error", () => {
    render(
      <AttachmentImage
        filePath="/tmp/sample.png"
        alt="attachment"
        preferThumbnail
      />
    );

    const image = screen.getByAltText("attachment") as HTMLImageElement;
    expect(image.src).toContain("asset:///tmp/sample_thumb.jpg");

    fireEvent.error(image);

    expect(screen.getByAltText("attachment")).toHaveAttribute(
      "src",
      "asset:///tmp/sample.png"
    );
  });

  it("renders the fallback state after the original image also fails", () => {
    render(
      <AttachmentImage
        filePath="/tmp/sample.png"
        alt="attachment"
        preferThumbnail
        fallbackClassName="fallback"
      />
    );

    const image = screen.getByAltText("attachment");
    fireEvent.error(image);
    fireEvent.error(screen.getByAltText("attachment"));

    expect(screen.queryByAltText("attachment")).not.toBeInTheDocument();
    expect(document.querySelector(".fallback")).toBeInTheDocument();
  });
});
