import { ImageResponse } from "next/og";

export const runtime = "edge";

/** PNG app icons for the web manifest (letter P on graphite). */
export function GET(_req: Request, { params }: { params: { size: string } }) {
  const size = params.size === "512" ? 512 : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1C1C1E", color: "#fff", fontSize: size * 0.6, fontWeight: 700 }}>
        P
      </div>
    ),
    { width: size, height: size },
  );
}
