import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const socialImageAlt =
  "Crabtree app showing Codex chats, worktrees, branches, and Git history";
export const socialImageContentType = "image/png";
// TODO: AI-PICKED-VALUE: These layout sizes keep the app screenshot readable in a standard large social preview.
export const socialImageSize = {
  width: 1200,
  height: 630,
};

export const createSocialImage = async () => {
  const appIconData = await readFile(
    join(process.cwd(), "src/assets/default-app-icon.png"),
    "base64",
  );
  const productScreenshotData = await readFile(
    join(process.cwd(), "src/assets/product-screenshot.png"),
    "base64",
  );
  const appIconSrc = `data:image/png;base64,${appIconData}`;
  const productScreenshotSrc = `data:image/png;base64,${productScreenshotData}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        background: "#ffffff",
        color: "#101410",
        padding: "62px 66px",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: 414,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          <img src={appIconSrc} width={86} height={86} alt="" />
          <div
            style={{
              fontSize: 50,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            Crabtree
          </div>
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 850,
            lineHeight: 1.02,
            letterSpacing: 0,
            paddingLeft: 16,
          }}
        >
          Easily merge your agents.
        </div>
      </div>
      <img
        src={productScreenshotSrc}
        width={650}
        height={441}
        alt=""
        style={{
          objectFit: "contain",
        }}
      />
    </div>,
    {
      ...socialImageSize,
    },
  );
};
