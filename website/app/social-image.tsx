import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const socialImageAlt =
  "MoltTree app showing Codex chats, worktrees, branches, and Git history";
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
        gap: 42,
        background: "#f7f8f5",
        color: "#101410",
        padding: "54px 58px",
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
            MoltTree
          </div>
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 850,
            lineHeight: 1.02,
            letterSpacing: 0,
          }}
        >
          Easily merge your Codex worktrees.
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            fontSize: 19,
            fontWeight: 800,
          }}
        >
          <div
            style={{
              border: "1px solid #d5b55f",
              borderRadius: 5,
              background: "#fff4cf",
              color: "#101410",
              padding: "8px 14px",
            }}
          >
            Chats
          </div>
          <div
            style={{
              border: "1px solid #aeb9c7",
              borderRadius: 5,
              background: "#eaf1ff",
              color: "#101410",
              padding: "8px 14px",
            }}
          >
            Branches
          </div>
          <div
            style={{
              border: "1px solid #aeb9c7",
              borderRadius: 5,
              background: "#eef0f3",
              color: "#101410",
              padding: "8px 14px",
            }}
          >
            Worktrees
          </div>
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
