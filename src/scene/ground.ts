import * as T from "three";

export const groundOptions = ["ivory", "sand", "slate", "grass"] as const;
export type GroundStyle = (typeof groundOptions)[number];
export function groundStyle(value: string | null): GroundStyle {
  return groundOptions.includes(value as GroundStyle)
    ? (value as GroundStyle)
    : "ivory";
}

/** Generated locally once: no external assets, requests, or texture licensing. */
function grassTexture(anisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  let seed = 731;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  ctx.fillStyle = "#526a32";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 18000; i++) {
    const x = random() * 512,
      y = random() * 512;
    const dx = (random() - 0.5) * 10,
      dy = 3 + random() * 12;
    ctx.strokeStyle = `hsl(${75 + random() * 35}  ${25 + random() * 22}% ${20 + random() * 23}%)`;
    ctx.lineWidth = 0.6 + random() * 1.2;
    // Wrap strokes over every edge so repeating tiles have no cut seams.
    for (const ox of [-512, 0, 512])
      for (const oy of [-512, 0, 512]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + dx + ox, y - dy + oy);
        ctx.stroke();
      }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(40, 40);
  texture.anisotropy = anisotropy;
  return texture;
}

export function groundController(
  material: T.MeshStandardMaterial,
  grid: T.GridHelper,
  anisotropy: number,
) {
  let grass: T.CanvasTexture | undefined;
  const colors = {
    ivory: "#f0ede5",
    sand: "#c9a875",
    slate: "#697984",
    grass: "#ffffff",
  };
  return (style: GroundStyle) => {
    if (style === "grass") grass ??= grassTexture(anisotropy);
    material.color.set(colors[style]);
    material.map = style === "grass" ? grass! : null;
    material.bumpMap = material.map;
    material.bumpScale = style === "grass" ? 0.035 : 0;
    material.roughness = style === "grass" ? 1 : 0.9;
    material.needsUpdate = true;
    grid.visible = style !== "grass";
  };
}
