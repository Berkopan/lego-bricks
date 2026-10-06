import { jsPDF } from "jspdf";
import { Euler, Vector3, Quaternion } from "three";
import { partLabel } from "../engine/catalog";
import type { Language } from "../i18n";
import {
  createManualPlan,
  type ManualAssembly,
  type ManualBrick,
  type ManualStep,
  type SceneSnapshot,
} from "./plan";
import { ManualRenderer } from "./render";
import { manualColorName, manualLabels } from "./labels";
import regularFontUrl from "./fonts/DejaVuSans.ttf?url";
import boldFontUrl from "./fonts/DejaVuSans-Bold.ttf?url";

interface ManualOptions {
  language: Language;
  signal?: AbortSignal;
  onProgress?(progress: { completed: number; total: number }): void;
}

const PAGE = { width: 297, height: 210, margin: 14 };
const INK = "#233743",
  MUTED = "#61717b",
  LINE = "#d8e1e6";
const BLUE = "#edf4f8",
  AMBER = "#df971f";
const PIXELS_PER_MM = 6;
const PER_INVENTORY_PAGE = 20,
  PER_PLACEMENT_PAGE = 8;
const number = (value: number, digits = 3) => {
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded);
};
const angles = (q: Quaternion) => {
  const normalized = q.clone().normalize();
  // Euler XYZ has an equivalent but confusing (-180, 0, -180) form for a
  // half-turn. Describe ordinary upright parts as a simple turn about Y.
  if (
    new Vector3(0, 1, 0)
      .applyQuaternion(normalized)
      .distanceToSquared(new Vector3(0, 1, 0)) < 1e-12
  ) {
    const axis = new Vector3(1, 0, 0).applyQuaternion(normalized);
    let yaw = (Math.atan2(-axis.z, axis.x) * 180) / Math.PI;
    if (Math.abs(Math.abs(yaw) - 180) < 0.005) yaw = 180;
    return `0 / ${number(yaw, 2)} / 0`;
  }
  const euler = new Euler().setFromQuaternion(normalized, "XYZ");
  return [euler.x, euler.y, euler.z]
    .map((v) => number((v * 180) / Math.PI, 2))
    .join(" / ");
};
const coordinates = (p: Vector3) =>
  [p.x, p.y, p.z].map((v) => number(v)).join(" / ");
const chunks = <T>(values: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) =>
    values.slice(i * size, (i + 1) * size),
  );

async function fontData(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not load the manual font");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Entirely local, lazy-loaded PDF generation. Yield between pages and images
 * so progress/cancellation work even on phones; no live scene objects are used. */
export async function generateManual(
  snapshot: SceneSnapshot,
  options: ManualOptions,
): Promise<Blob> {
  const { signal, language } = options;
  const t = manualLabels[language];
  const checkpoint = async () => {
    signal?.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  };
  await checkpoint();
  const plan = createManualPlan(snapshot);
  if (!plan.bricks.length) throw new Error("The scene contains no bricks");
  const inventoryPages = chunks(plan.inventory, PER_INVENTORY_PAGE);
  // A warning can reference hundreds of parts. Split both notes and references
  // before laying out pages; never clip the end of an exceptional scene.
  const warningRows = plan.warnings.flatMap((warning) =>
    chunks(warning.brickIds, 40).map((ids) => ({ ...warning, brickIds: ids })),
  );
  const warningPages = chunks(warningRows, 3);
  const placementPages = chunks(plan.assemblies, PER_PLACEMENT_PAGE);
  const total =
    inventoryPages.length +
    1 +
    warningPages.length +
    plan.steps.length +
    1 +
    placementPages.length;
  options.onProgress?.({ completed: 0, total });
  const fonts = await Promise.all([
    fontData(regularFontUrl, signal),
    fontData(boldFontUrl, signal),
  ]);
  await checkpoint();
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  pdf.addFileToVFS("ManualSans.ttf", fonts[0]);
  pdf.addFileToVFS("ManualSans-Bold.ttf", fonts[1]);
  pdf.addFont("ManualSans.ttf", "ManualSans", "normal");
  pdf.addFont("ManualSans-Bold.ttf", "ManualSans", "bold");
  pdf.setProperties({
    title: t.title,
    subject: `${plan.bricks.length} ${t.pieces} · ${plan.steps.length} ${t.steps}`,
    author: "bricks.",
    creator: "bricks. building manual",
  });
  pdf.setLanguage(language);
  const render = new ManualRenderer(plan.bricks);
  const flat = document.createElement("canvas");
  const flatContext = flat.getContext("2d");
  if (!flatContext) {
    render.dispose();
    throw new Error("Canvas is unavailable");
  }
  const byId = new Map(plan.bricks.map((b) => [b.id, b]));
  const pieceNumbers = new Map(
    plan.steps.flatMap((s) => s.added.map((id) => [id, s.number] as const)),
  );
  const allIds = plan.bricks.map((b) => b.id);
  let pageNumber = 0;

  function text(
    value: string,
    x: number,
    y: number,
    size = 10,
    bold = false,
    color = INK,
    align: "left" | "center" | "right" = "left",
  ) {
    pdf.setFont("ManualSans", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(color);
    pdf.text(value, x, y, { align });
  }
  function paragraph(
    value: string,
    x: number,
    y: number,
    width: number,
    size = 9,
    color = MUTED,
  ) {
    pdf.setFont("ManualSans", "normal");
    pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(value, width);
    pdf.setTextColor(color);
    pdf.text(lines, x, y, { lineHeightFactor: 1.45 });
    return y + lines.length * size * 0.3528 * 1.45;
  }
  function panel(x: number, y: number, w: number, h: number, fill = BLUE) {
    pdf.setFillColor(fill);
    pdf.setDrawColor(LINE);
    pdf.setLineWidth(0.25);
    pdf.roundedRect(x, y, w, h, 2, 2, "FD");
  }
  function bitmap(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    background = "#ffffff",
  ) {
    flat.width = canvas.width;
    flat.height = canvas.height;
    flatContext!.fillStyle = background;
    flatContext!.fillRect(0, 0, flat.width, flat.height);
    flatContext!.drawImage(canvas, 0, 0);
    // White/light panels compress efficiently; document text stays vector and
    // searchable. A single staging canvas and renderer are reused throughout.
    pdf.addImage(flat.toDataURL("image/jpeg", 0.94), "JPEG", x, y, w, h);
  }
  function startPage(section: string) {
    if (pageNumber++) pdf.addPage();
    pdf.setFillColor("#ffffff");
    pdf.rect(0, 0, PAGE.width, PAGE.height, "F");
    text("bricks.", 14, 13, 17, true);
    text(t.title.toLocaleUpperCase(language), 44, 12.5, 7.5, true, MUTED);
    text(section, 283, 12.5, 8, false, MUTED, "right");
    pdf.setDrawColor(LINE);
    pdf.setLineWidth(0.3);
    pdf.line(14, 17, 283, 17);
    pdf.line(14, 197, 283, 197);
    text(t.independent, 14, 203, 7, false, MUTED);
    text(`${pageNumber} / ${total}`, 283, 203, 8, true, INK, "right");
  }
  async function finishPage() {
    options.onProgress?.({ completed: pageNumber, total });
    await checkpoint();
  }
  function renderView(
    ids: readonly number[],
    x: number,
    y: number,
    width: number,
    height: number,
    other: Omit<
      Parameters<ManualRenderer["render"]>[0],
      "ids" | "width" | "height"
    > = {},
    background = "#ffffff",
  ) {
    const result = render.render({
      ids,
      width: Math.round(width * PIXELS_PER_MM),
      height: Math.round(height * PIXELS_PER_MM),
      ...other,
    });
    bitmap(result.canvas, x, y, width, height, background);
    return {
      ...result,
      at: (p: { x: number; y: number }) => ({
        x: x + p.x / PIXELS_PER_MM,
        y: y + p.y / PIXELS_PER_MM,
      }),
    };
  }
  function badge(
    label: string,
    x: number,
    y: number,
    amber = false,
    radius = 3.4,
  ) {
    pdf.setDrawColor(amber ? AMBER : INK);
    pdf.setLineWidth(0.4);
    pdf.setFillColor(amber ? "#fff3d6" : "#ffffff");
    pdf.circle(x, y, radius, "FD");
    text(label, x, y + 1, label.length > 2 ? 6.5 : 8, true, INK, "center");
  }
  function arrow(from: { x: number; y: number }, to: { x: number; y: number }) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 1) return;
    const ux = (to.x - from.x) / length,
      uy = (to.y - from.y) / length;
    const head = Math.min(2.2, length / 2);
    pdf.setDrawColor(AMBER);
    pdf.setFillColor(AMBER);
    pdf.setLineWidth(0.7);
    pdf.line(from.x, from.y, to.x - ux * head * 0.6, to.y - uy * head * 0.6);
    pdf.triangle(
      to.x,
      to.y,
      to.x - ux * head - uy * head * 0.5,
      to.y - uy * head + ux * head * 0.5,
      to.x - ux * head + uy * head * 0.5,
      to.y - uy * head - ux * head * 0.5,
      "F",
    );
  }
  const transform = (assembly: ManualAssembly) => ({
    origin: assembly.origin,
    rotation: assembly.rotation.clone().invert(),
  });
  const pieceRef = (id: number) =>
    String(pieceNumbers.get(id)).padStart(2, "0");

  try {
    // Begin with the color-specific inventory; large inventories continue onto
    // additional pages instead of shrinking labels below readable print sizes.
    for (const [index, entries] of inventoryPages.entries()) {
      startPage(`${t.inventory} · ${index + 1} / ${inventoryPages.length}`);
      text(index ? t.inventoryMore : t.inventory, 14, 32, 22, true);
      text(
        `${plan.bricks.length} ${t.pieces}`,
        283,
        30,
        16,
        true,
        INK,
        "right",
      );
      paragraph(t.inventoryHint, 14, 41, 240, 10);
      const cols = 5,
        gap = 4,
        width = (269 - gap * (cols - 1)) / cols,
        height = 32;
      for (const [i, entry] of entries.entries()) {
        await checkpoint();
        const x = 14 + (i % cols) * (width + gap),
          y = 51 + Math.floor(i / cols) * (height + 3);
        panel(x, y, width, height, "#fafcfd");
        bitmap(
          render.thumbnail(entry.spec, entry.color, 210, 130),
          x + 1,
          y + 1,
          30,
          18.6,
          "#fafcfd",
        );
        text(`${entry.count}×`, x + width - 4, y + 12, 17, true, INK, "right");
        text(partLabel(entry.spec, language), x + 3, y + 24, 7.6, true);
        text(
          manualColorName(entry.color, language),
          x + 3,
          y + 29,
          7.1,
          false,
          MUTED,
        );
        pdf.setFillColor(entry.color);
        pdf.setDrawColor("#a2adb4");
        pdf.setLineWidth(0.2);
        pdf.rect(x + width - 8, y + 26, 4, 4, "FD");
        // Arbitrary imported colors remain identifiable without relying on a
        // printer's color fidelity or a nearest-palette name.
        text(
          entry.color.toUpperCase(),
          x + width - 10,
          y + 29,
          5.6,
          false,
          MUTED,
          "right",
        );
      }
      text(
        index < inventoryPages.length - 1
          ? t.continued
          : `${plan.inventory.length} ${t.variants} · ${plan.steps.length} ${t.steps}`,
        14,
        193,
        8,
        false,
        MUTED,
      );
      await finishPage();
    }

    startPage(t.plan);
    text(t.plan, 14, 32, 22, true);
    paragraph(t.planHint, 14, 41, 266, 10);
    panel(14, 57, 173, 129, BLUE);
    renderView(allIds, 17, 60, 167, 112, { viewpoint: "world" }, BLUE);
    text(
      `${plan.bricks.length} ${t.pieces}  ·  ${plan.assemblies.length} ${t.assembly.toLocaleLowerCase(language)}  ·  ${plan.steps.length} ${t.steps}`,
      100,
      181,
      10,
      true,
      INK,
      "center",
    );
    text(t.reading, 198, 63, 12, true);
    let y = paragraph(t.readingText, 198, 71, 84, 9);
    pdf.setFillColor("#fff0cc");
    pdf.setDrawColor(AMBER);
    pdf.rect(198, y + 2, 4, 4, "FD");
    text(t.legendNew, 205, y + 5.5, 8.5);
    pdf.setFillColor("#dde2e5");
    pdf.setDrawColor("#abb7bc");
    pdf.rect(198, y + 11, 4, 4, "FD");
    text(t.legendOld, 205, y + 14.5, 8.5);
    text(t.coordinates, 198, y + 29, 12, true);
    paragraph(t.coordinateText, 198, y + 37, 84, 8.4);
    await finishPage();

    for (const warnings of warningPages) {
      startPage(t.caution);
      text(t.caution, 14, 32, 22, true);
      for (const [index, warning] of warnings.entries()) {
        const y = 43 + index * 50;
        panel(14, y, 269, 45, "#fff8e9");
        renderView(
          warning.brickIds,
          17,
          y + 2,
          50,
          40,
          { viewpoint: "world" },
          "#fff8e9",
        );
        const after = paragraph(t[warning.code], 74, y + 10, 200, 10, INK);
        paragraph(
          `${t.notes}: ${warning.brickIds.map(pieceRef).join(", ")}`,
          74,
          after + 2,
          199,
          8,
          MUTED,
        );
      }
      await finishPage();
    }

    async function stepPage(step: ManualStep, assembly: ManualAssembly) {
      startPage(
        `${t.assembly} ${assembly.number} · ${t.step} ${step.number} / ${plan.steps.length}`,
      );
      const brick = byId.get(step.added[0])!;
      const frame = transform(assembly);
      const needsSupport =
        !step.supports.length &&
        plan.warnings.some(
          (w) => w.code === "unsupported" && w.brickIds.includes(brick.id),
        );
      const titleX = step.number >= 100 ? 49 : 38;
      text(
        String(step.number).padStart(2, "0"),
        14,
        39,
        step.number >= 100 ? 28 : 32,
        true,
      );
      text(`${t.assembly} ${assembly.number}`, titleX, 28, 13, true);
      paragraph(
        needsSupport
          ? t.supportStep
          : step.supports.length
            ? t.attach
            : assembly.brickIds.length === 1
              ? t.free
              : t.base,
        titleX,
        36,
        196 - titleX,
        8.5,
      );
      panel(210, 22, 73, 40, BLUE);
      text(t.add, 214, 28, 7.5, true, MUTED);
      bitmap(
        render.thumbnail(brick.spec, brick.color, 240, 144),
        212,
        29,
        36,
        21.6,
        BLUE,
      );
      text("1×", 273, 40, 21, true, INK, "right");
      text(partLabel(brick.spec, language), 214, 55, 8, true);
      text(
        `${manualColorName(brick.color, language)} · ${brick.color.toUpperCase()}`,
        214,
        60,
        6.5,
        false,
        MUTED,
      );
      await checkpoint();

      const main = renderView(step.built, 14, 47, 184, 120, {
        frameIds: assembly.brickIds,
        highlightIds: step.added,
        transform: frame,
        viewpoint: "assembly",
      });
      const origin = main.project(assembly.origin);
      if (origin.visible) {
        const at = main.at(origin);
        pdf.setDrawColor(MUTED);
        pdf.setLineWidth(0.25);
        pdf.line(at.x - 1.5, at.y, at.x + 1.5, at.y);
        pdf.line(at.x, at.y - 1.5, at.x, at.y + 1.5);
        text("0", at.x + 2.5, Math.min(166, at.y + 3.5), 7, false, MUTED);
      }
      const anchor = main.anchors.get(brick.id);
      if (anchor?.visible) {
        const point = main.at(anchor);
        const x = Math.max(19, Math.min(192, point.x + 9));
        const y = Math.max(53, Math.min(159, point.y - 10));
        pdf.setDrawColor(AMBER);
        pdf.setLineWidth(0.35);
        pdf.line(x, y + 2, point.x, point.y);
        badge(pieceRef(brick.id), x, y, true);
      }
      pdf.setFillColor("#fff0cc");
      pdf.setDrawColor(AMBER);
      pdf.rect(15, 173, 3, 3, "FD");
      text(t.legendNew, 21, 175.5, 7.5);
      pdf.setFillColor("#e2e6e9");
      pdf.setDrawColor("#abb7bc");
      pdf.rect(83, 173, 3, 3, "FD");
      text(t.legendOld, 89, 175.5, 7.5);
      await checkpoint();

      text(t.detail, 212, 70, 7.5, true, MUTED);
      panel(210, 74, 73, 48, BLUE);
      const detailIds = [...new Set([...step.supports, ...step.added])];
      const up = new Vector3(0, 1, 0).applyQuaternion(assembly.rotation);
      const offsets = step.supports.length
        ? new Map(step.added.map((id) => [id, up.clone().multiplyScalar(1.1)]))
        : undefined;
      const detail = renderView(
        detailIds,
        212,
        76,
        69,
        44,
        {
          frameIds: detailIds,
          highlightIds: step.added,
          transform: frame,
          viewpoint: "detail",
          offsets,
          padding: 0.2,
        },
        BLUE,
      );
      if (step.supports.length) {
        // The large and top views show the final pose; this inset alone lifts
        // the addition to explain how its sockets meet the existing studs.
        const bottom = brick.position
          .clone()
          .addScaledVector(up, -brick.spec.height / 2);
        const from = detail.project(bottom.clone().addScaledVector(up, 0.95));
        const to = detail.project(bottom.clone().addScaledVector(up, 0.1));
        if (from.visible && to.visible) arrow(detail.at(from), detail.at(to));
      }
      await checkpoint();
      text(t.top, 212, 131, 7.5, true, MUTED);
      panel(210, 135, 73, 49, BLUE);
      renderView(
        detailIds,
        212,
        137,
        69,
        45,
        {
          frameIds: detailIds,
          highlightIds: step.added,
          transform: frame,
          viewpoint: "top",
          grid: true,
          padding: 0.17,
        },
        BLUE,
      );
      text("X →     Z ↓", 281, 189, 7, false, MUTED, "right");
      const local = brick.position
        .clone()
        .sub(assembly.origin)
        .applyQuaternion(frame.rotation);
      const localRotation = frame.rotation.clone().multiply(brick.rotation);
      panel(14, 181, 184, 11, "#f6f8f9");
      text(
        `#${pieceRef(brick.id)}   X / H / Z: ${coordinates(local)}`,
        17,
        187.8,
        7.7,
        true,
      );
      text(
        `X / Y / Z: ${angles(localRotation)}°`,
        194,
        187.8,
        7.7,
        false,
        MUTED,
        "right",
      );
      await finishPage();
    }
    for (const assembly of plan.assemblies)
      for (const step of assembly.steps) await stepPage(step, assembly);

    startPage(t.final);
    text(t.final, 14, 32, 22, true);
    paragraph(t.finalHint, 14, 41, 265, 9.5);
    text(t.worldIso, 14, 59, 8, true, MUTED);
    panel(14, 64, 177, 124, BLUE);
    renderView(allIds, 17, 67, 171, 118, { viewpoint: "world" }, BLUE);
    await checkpoint();
    text(t.worldTop, 200, 59, 8, true, MUTED);
    panel(198, 64, 85, 124, BLUE);
    renderView(
      allIds,
      200,
      67,
      81,
      111,
      { viewpoint: "top", grid: true },
      BLUE,
    );
    text("X →     Z ↓", 278, 184, 8, false, MUTED, "right");
    await finishPage();

    for (const [index, assemblies] of placementPages.entries()) {
      startPage(`${t.placement} · ${index + 1} / ${placementPages.length}`);
      text(t.placement, 14, 32, 22, true);
      paragraph(t.placementHint, 14, 41, 268, 9);
      text(t.assembly, 15, 60, 8, true, MUTED);
      text(t.position, 58, 60, 8, true, MUTED);
      text(t.rotation, 114, 60, 8, true, MUTED);
      for (const [row, assembly] of assemblies.entries()) {
        const y = 65 + row * 14.5;
        if (row % 2 === 0) {
          pdf.setFillColor("#f3f7f9");
          pdf.rect(14, y, 167, 14.5, "F");
        }
        badge(String(assembly.number), 20, y + 6.4);
        text(`${assembly.brickIds.length} ${t.pieces}`, 27, y + 5.5, 7.5);
        text(
          `${t.step} ${assembly.steps[0].number}–${assembly.steps.at(-1)!.number}`,
          27,
          y + 10.3,
          6.5,
          false,
          MUTED,
        );
        text(coordinates(assembly.origin), 58, y + 8, 7.4);
        text(angles(assembly.rotation), 114, y + 8, 7.2);
      }
      text(t.units, 14, 189, 7.4, false, MUTED);
      panel(189, 56, 94, 128, BLUE);
      const map = renderView(
        allIds,
        191,
        59,
        90,
        120,
        {
          frameIds: allIds,
          highlightIds: assemblies.flatMap((a) => a.brickIds),
          viewpoint: "top",
          grid: true,
          padding: 0.17,
        },
        BLUE,
      );
      // Labels on a crowded world map get short leader lines and bounded rows;
      // only this page's assemblies are numbered, avoiding a 250-label pileup.
      const used: { x: number; y: number }[] = [];
      for (const assembly of assemblies) {
        const projected = map.project(assembly.origin);
        const at = map.at(projected);
        const label = {
          x: Math.max(195, Math.min(276, at.x + 5)),
          y: Math.max(63, Math.min(174, at.y - 5)),
        };
        for (
          let attempt = 0;
          attempt < 18 &&
          used.some((p) => Math.hypot(p.x - label.x, p.y - label.y) < 8);
          attempt++
        ) {
          label.y += 8;
          if (label.y > 174) {
            label.y = 63;
            label.x = Math.max(195, label.x - 10);
          }
        }
        used.push(label);
        pdf.setLineWidth(0.3);
        pdf.setDrawColor(MUTED);
        pdf.line(label.x, label.y, at.x, at.y);
        badge(String(assembly.number), label.x, label.y);
      }
      text("X →     Z ↓", 282, 189, 8, false, MUTED, "right");
      await finishPage();
    }
    signal?.throwIfAborted();
    return pdf.output("blob");
  } finally {
    render.dispose();
    flat.width = flat.height = 1;
  }
}
