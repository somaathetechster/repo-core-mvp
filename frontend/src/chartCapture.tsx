import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import ChartView from "./ChartView";
import type { DeckSlide } from "./api";

const CAPTURE_WIDTH = 600;
const CAPTURE_HEIGHT = 340;

/**
 * Renders every chart-type slide off-screen (not visible to the user, and
 * not the live editor's own chart instances) with animation disabled, then
 * screenshots each one to a PNG data URL using html2canvas. This is what
 * lets exported PPTX/PDF files contain a real chart image instead of a
 * data table.
 *
 * Off-screen rendering, rather than capturing whatever chart happens to be
 * currently visible in the editor, means export works correctly regardless
 * of which slide the user has open, and multiple charts can be captured in
 * one pass.
 */
export async function captureChartImages(slides: DeckSlide[]): Promise<Record<string, string>> {
  const chartSlides = slides.filter((s) => s.type === "chart" && s.chart);
  if (chartSlides.length === 0) return {};

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "-9999px";
  container.style.left = "-9999px";
  container.style.width = `${CAPTURE_WIDTH}px`;
  container.style.background = "#ffffff";
  document.body.appendChild(container);

  const results: Record<string, string> = {};

  try {
    for (const slide of chartSlides) {
      const slideDiv = document.createElement("div");
      slideDiv.style.width = `${CAPTURE_WIDTH}px`;
      slideDiv.style.height = `${CAPTURE_HEIGHT}px`;
      slideDiv.style.background = "#ffffff";
      container.appendChild(slideDiv);

      const root = createRoot(slideDiv);
      const chart = slide.chart!;
      root.render(
        <ChartView chartType={chart.chart_type} columns={chart.columns} rows={chart.rows} height={CAPTURE_HEIGHT} />
      );

      await new Promise((resolve) => setTimeout(resolve, 150));

      try {
        const canvas = await html2canvas(slideDiv, { backgroundColor: "#ffffff", scale: 2 });
        results[slide.id] = canvas.toDataURL("image/png");
      } catch {
        // If a specific chart fails to capture, skip it rather than
        // failing the whole export; the backend falls back to a data
        // table for any slide without a captured image.
      }

      root.unmount();
      container.removeChild(slideDiv);
    }
  } finally {
    document.body.removeChild(container);
  }

  return results;
}
