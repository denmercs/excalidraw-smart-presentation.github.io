import { useEffect, useRef, useState } from "react";
import { exportToSvg } from "@excalidraw/excalidraw";
import { THEME } from "@excalidraw/common";

import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";

const THUMBNAIL_SCALE = 0.25;

const buildThumbnail = (
  frame: ExcalidrawFrameElement,
  elements: ExcalidrawElement[],
  appState: Readonly<AppState>,
  files: BinaryFiles,
) =>
  exportToSvg({
    elements: elements as any,
    appState: {
      exportBackground: true,
      exportScale: THUMBNAIL_SCALE,
      viewBackgroundColor: appState.viewBackgroundColor,
      exportWithDarkMode: appState.theme === THEME.DARK,
      exportEmbedScene: false,
    },
    files,
    exportPadding: 0,
    exportingFrame: frame,
    skipInliningFonts: true,
  });

const Thumbnail = ({ svg }: { svg: SVGSVGElement | null }) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = container.current;
    if (!node || !svg) {
      return;
    }
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    node.replaceChildren(clone);
    return () => {
      node.replaceChildren();
    };
  }, [svg]);

  return <div className="presentation-slide-thumbnail" ref={container} />;
};

export function SlideSwitcher(props: {
  frames: ExcalidrawFrameElement[];
  elements: ExcalidrawElement[];
  appState: Readonly<AppState>;
  files: BinaryFiles;
  currentIndex: number;
  highlightedIndex: number;
  onSelect: (index: number) => void;
  onHighlight: (index: number) => void;
  onClose: () => void;
}) {
  const {
    appState,
    currentIndex,
    elements,
    files,
    frames,
    highlightedIndex,
    onClose,
    onHighlight,
    onSelect,
  } = props;

  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<string, SVGSVGElement>
  >(new Map());

  // Rendered one at a time so opening the switcher on a long deck doesn't block
  // the main thread, and results stream in as they're ready.
  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      for (const frame of frames) {
        if (cancelled) {
          return;
        }
        try {
          const svg = await buildThumbnail(frame, elements, appState, files);
          if (cancelled) {
            return;
          }
          setThumbnails((current) => new Map(current).set(frame.id, svg));
        } catch (error: any) {
          console.error(
            "Presentation: failed to render slide thumbnail",
            frame.id,
            error,
          );
        }
      }
    };

    render();

    return () => {
      cancelled = true;
    };
  }, [appState, elements, files, frames]);

  const highlighted = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  return (
    <div
      className="presentation-switcher"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="presentation-switcher-panel">
        <div className="presentation-switcher-header">
          <span>Jump to slide</span>
          <span className="presentation-switcher-hint">
            arrows to browse · enter to jump · esc to cancel
          </span>
        </div>
        <div className="presentation-switcher-grid">
          {frames.map((frame, index) => (
            <button
              key={frame.id}
              type="button"
              ref={index === highlightedIndex ? highlighted : undefined}
              className="presentation-slide-card"
              aria-current={index === currentIndex}
              data-highlighted={index === highlightedIndex}
              onPointerEnter={() => onHighlight(index)}
              onClick={() => onSelect(index)}
            >
              <Thumbnail svg={thumbnails.get(frame.id) ?? null} />
              <span className="presentation-slide-label">
                <span className="presentation-slide-number">{index + 1}</span>
                {frame.name && (
                  <span className="presentation-slide-name">{frame.name}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
